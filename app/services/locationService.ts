import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import axios from 'axios';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { distanciaMetros, FiltroKalman } from './filtroUbicacion';

// Puerto donde corre el backend local
const BACKEND_PORT = 4000;

// URL fija del backend cuando no se usa el modo local.
// En desarrollo local: definir EXPO_PUBLIC_OVERRIDE_BACKEND_URL=local
// en .env.local para que use la IP del equipo desde Expo Go.
const OVERRIDE_BACKEND_URL = process.env.EXPO_PUBLIC_OVERRIDE_BACKEND_URL;

// Frecuencia de muestreo (30 s para pruebas, luego ajustar a 60 s)
const INTERVALO_MS = 30 * 1000;
// Máximo tiempo de espera para obtener un fix nuevo de ubicación
const TIMEOUT_UBICACION_MS = 20000;

// Precisión máxima aceptada en metros: los puntos peores que esto se descartan.
const ACCURACY_MAXIMA_MS = 30;
// Antigüedad máxima (ms) aceptada para el fallback de "última posición conocida".
const FRESCURA_LAST_KNOWN_MS = 120000;
// Velocidad máxima plausible (km/h) para detectar picos GPS (satélite saltando).
// Una camioneta en ruta no supera esto por sí sola.
const VELOCIDAD_MAXIMA_KMH = 100;
const VELOCIDAD_MAXIMA_MS = VELOCIDAD_MAXIMA_KMH / 3.6;
// Tope absoluto por salto (m) para desviaciones en una VENTANA CORTA de tiempo.
// No se aplica a muestras separadas por más de MAXIMO_DT_TOPE_SEG segundos:
// entre muestras largas (30 s) un vehículo a velocidad legal recorre cientos de
// metros sin que eso sea un salto.
const SALTO_MAXIMO_M = 150;
const MAXIMO_DT_TOPE_SEG = 20;
// Distancia mínima (m) respecto al último punto enviado para considerarse "movimiento".
const DISTANCIA_MINIMA_MOVIMIENTO_MS = 15;
// Clave en AsyncStorage de la última referencia aceptada (para validar el
// primer punto cuando el contexto de segundo plano arranca sin estado en memoria).
const KEY_ULTIMO_PUNTO_ACEPTADO = 'ultimo_punto_aceptado_v2';

// Nombre de la tarea que registra ubicación estando la app en segundo plano
const TAREA_UBICACION_FONDO = 'ubicacion-en-fondo';

export const getBackendUrl = (): string => {
  const override = OVERRIDE_BACKEND_URL;

  // Modo local (EXPO_PUBLIC_OVERRIDE_BACKEND_URL=local): usa la IP del host de
  // Metro, que es la misma máquina donde corre el backend, para que funcione
  // en el dispositivo real (Expo Go) dentro de la misma red Wi-Fi.
  if (override === 'local') {
    const hostUri = Constants.expoConfig?.hostUri;
    const host = hostUri?.split(':')[0];
    return host ? `http://${host}:${BACKEND_PORT}` : `http://localhost:${BACKEND_PORT}`;
  }

  // URL explícita definida en build/entorno.
  if (override) return override;

  // Valor por defecto (producción): coincide con el comportamiento previo.
  return 'https://backend-soporte-campo-vpc.onrender.com';
};

let intervaloForeground: ReturnType<typeof setInterval> | null = null;
let subscripcionCambios: Location.LocationSubscription | null = null;
let usuarioIdActual: string | null = null;
let ultimoEnvio: number = 0;
let avisoServiciosGPS = false;
let obteniendoUbicacion = false;
let ultimasCoordenadas: { latitude: number; longitude: number } | null = null;
// Filtro Kalman para suavizar la señal y último punto ACEPTADO por el pipeline
// (se usa para detectar picos GPS y alimenta el filtro).
let filtroKalman: FiltroKalman | null = null;
let ultimoPuntoAceptado: {
  latitude: number;
  longitude: number;
  timestamp: number;
} | null = null;

// Cola FIFO que serializa el procesado de TODOS los puntos (muestreo periódico,
// suscripción de cambios y segundo plano). Garantiza orden estricto por
// timestamp y evita que dos flujos procesen el mismo fix (doble ajuste del
// Kalman) o que uno llegue fuera de orden y se valide sin control de picos.
type ItemCola = {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  timestamp: number;
  usuarioId: string | null;
};
let colaPuntos: ItemCola[] = [];
let procesandoCola = false;
let ultimoTimestampProcesado: number | null = null;

// Regla de envío (1 punto por cambio real o por cadencia, nunca duplicados):
// - `bloqueoEnvioHasta` reserva (síncronamente) el derecho de enviar el próximo
//   MIN_INTERVALO_ENVIO_MS ms: si dos flujos (muestreo y suscripción) evalúan
//   casi al mismo tiempo, solo el primero pasa.
// - después, se envía si pasó la cadencia (usuario quieto, ruta continua) o si
//   el punto cambió de verdad (movimiento).
const MIN_INTERVALO_ENVIO_MS = 8000;

let bloqueoEnvioHasta = 0;

// Pipeline de validación y suavizado que corre para CADA punto nuevo, de forma
// serializada por la cola (1 punto a la vez, en orden de timestamp):
// 0) orden estricto / sin duplicados, 1) precisión mínima, 2) rechazo de picos
// GPS (tope de ventana corta + velocidad media), 3) filtro Kalman.
const procesarPunto = (
  coords: { latitude: number; longitude: number; accuracy: number | null },
  ts: number
): { latitude: number; longitude: number; accuracy: number | null } | null => {
  // (0) Orden estricto: se ignora cualquier punto fuera de orden o duplicado.
  // Antes, un fix viejo que llegaba "después" (típico con la suscripción y el
  // muestreo en paralelo) tenía dt <= 0, saltaba el control de picos y se
  // enviaba como salto.
  if (ultimoTimestampProcesado !== null && ts <= ultimoTimestampProcesado) {
    console.warn(`[APP] Punto fuera de orden/duplicado descartado (ts=${ts})`);
    return null;
  }
  ultimoTimestampProcesado = ts;

  // (1) Precisión mínima
  if (coords.accuracy == null || coords.accuracy > ACCURACY_MAXIMA_MS) {
    console.warn(
      `[APP] Punto descartado por precisión (${coords.accuracy ?? 'n/a'} m)`
    );
    return null;
  }

  // (2) Rechazo de picos vs. último punto ACEPTADO (el estado que se cree real)
  if (ultimoPuntoAceptado) {
    // dtSeg > 0 está garantizado por el control (0) de orden estricto.
    const dtSeg = (ts - ultimoPuntoAceptado.timestamp) / 1000;
    const dist = distanciaMetros(
      ultimoPuntoAceptado.latitude,
      ultimoPuntoAceptado.longitude,
      coords.latitude,
      coords.longitude
    );
    // Tope absoluto en ventana corta: un desplazamiento de +150 m en pocos
    // segundos es una teletransportación del proveedor, imposible al volante.
    if (dtSeg <= MAXIMO_DT_TOPE_SEG && dist > SALTO_MAXIMO_M) {
      console.warn(
        `[APP] Salto GPS descartado por tope de ventana (${dist.toFixed(0)} m en ${dtSeg.toFixed(0)} s)`
      );
      return null;
    }
    // Velocidad media implausible entre esta muestra y la anterior.
    if (dist / dtSeg > VELOCIDAD_MAXIMA_MS) {
      console.warn(
        `[APP] Pico GPS descartado por velocidad (${dist.toFixed(0)} m en ${dtSeg.toFixed(0)} s = ${((dist / dtSeg) * 3.6).toFixed(0)} km/h)`
      );
      return null;
    }
  }

  // (3) Suavizado Kalman
  if (!filtroKalman) filtroKalman = new FiltroKalman();
  const filtrado = filtroKalman.filtrar(
    coords.latitude,
    coords.longitude,
    coords.accuracy,
    ts
  );
  ultimoPuntoAceptado = {
    latitude: filtrado.latitude,
    longitude: filtrado.longitude,
    timestamp: ts
  };
  // Referencia para el siguiente arranque (contexto de segundo plano headless)
  void persistirUltimoPuntoAceptado();

  return { ...filtrado, accuracy: coords.accuracy };
};

const debeEnviar = (coords: { latitude: number; longitude: number }): boolean => {
  const ahora = Date.now();
  // Ya se decidió un envío hace menos de MIN_INTERVALO_ENVIO_MS ms → no duplicar.
  if (ahora < bloqueoEnvioHasta) return false;

  if (!ultimasCoordenadas) {
    bloqueoEnvioHasta = ahora + MIN_INTERVALO_ENVIO_MS;
    return true;
  }

  // (6) Filtro estacionario: distancia real (metros) al último punto enviado.
  const distancia = distanciaMetros(
    ultimasCoordenadas.latitude,
    ultimasCoordenadas.longitude,
    coords.latitude,
    coords.longitude
  );
  const enCadencia = !ultimoEnvio || ahora - ultimoEnvio >= INTERVALO_MS - 4000;
  if (enCadencia || distancia >= DISTANCIA_MINIMA_MOVIMIENTO_MS) {
    bloqueoEnvioHasta = ahora + MIN_INTERVALO_ENVIO_MS;
    return true;
  }
  return false;
};

const encolarPunto = (item: ItemCola) => {
  colaPuntos.push(item);
  void despacharCola();
};

// Procesa la cola de a un punto y en orden. Al estar serializado, no hay que
// preocuparse por dos flujos procesando a la vez: el orden estricto por
// timestamp de procesarPunto descarta duplicados y fixes viejos.
const despacharCola = async () => {
  if (procesandoCola) return;
  procesandoCola = true;
  try {
    while (colaPuntos.length > 0) {
      const item = colaPuntos.shift()!;
      try {
        const punto = procesarPunto(item.coords, item.timestamp);
        if (!punto) continue;
        if (!debeEnviar(punto)) continue;
        await enviarUbicacion(punto, item.usuarioId);
      } catch (error) {
        console.error("[APP] Error procesando punto de ruta:", error);
      }
    }
  } finally {
    procesandoCola = false;
  }
};

// Util para el contexto de segundo plano: la tarea espera aquí hasta que la
// cola termine de drenarse antes de que el runtime la mate.
const esperarColaVacia = (): Promise<void> =>
  new Promise((resolve) => {
    const tick = () => {
      if (!procesandoCola && colaPuntos.length === 0) resolve();
      else setTimeout(tick, 200);
    };
    tick();
  });

const persistirUltimoPuntoAceptado = async () => {
  if (!ultimoPuntoAceptado) return;
  try {
    await AsyncStorage.setItem(
      KEY_ULTIMO_PUNTO_ACEPTADO,
      JSON.stringify(ultimoPuntoAceptado)
    );
  } catch {
    // Solo es una referencia de respaldo; se ignora si no se puede guardar.
  }
};

// Solo se adopta la referencia persistida si está FRESCA. Si pertenece a una
// sesión anterior (p. ej. el usuario arrancó el día en otra zona), el primer
// punto se valida sin referencia en lugar de descartarse por distancia.
const cargarUltimoPuntoAceptado = async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY_ULTIMO_PUNTO_ACEPTADO);
    if (!raw) return;
    const migrado = JSON.parse(raw) as {
      latitude: number;
      longitude: number;
      timestamp: number;
    };
    if (
      typeof migrado?.latitude !== 'number' ||
      typeof migrado?.longitude !== 'number' ||
      typeof migrado?.timestamp !== 'number'
    ) {
      return;
    }
    if (Date.now() - migrado.timestamp > FRESCURA_LAST_KNOWN_MS) return;
    ultimoPuntoAceptado = migrado;
    ultimoTimestampProcesado = migrado.timestamp;
    console.log("[APP] Referencia de validación cargada desde almacenamiento");
  } catch {
    // Dato corrupto o sin permisos: se arranca sin referencia.
  }
};

const enviarUbicacion = async (
  coords: { latitude: number; longitude: number; accuracy: number | null },
  usuarioId: string | null
) => {
  const uid = usuarioId ?? usuarioIdActual;
  if (!uid) return;

  try {
    console.log(
      `[APP] Enviando ubicación (usuario ${uid}) → ${getBackendUrl()}/ubicacion/historial`
    );
    await axios.post(
      `${getBackendUrl()}/ubicacion/historial`,
      {
        usuario_id: uid,
        latitud: String(coords.latitude),
        longitud: String(coords.longitude),
        accuracy: coords.accuracy
      },
      { timeout: 10000 }
    );
    ultimoEnvio = Date.now();
    ultimasCoordenadas = { latitude: coords.latitude, longitude: coords.longitude };
    console.log(
      `Punto de ruta registrado para ${uid}: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`
    );
  } catch (error) {
    console.error("Error al enviar ubicación al backend:", error);
  }
};

// Obtiene la posición. Primero pide un fix NUEVO con Alta precisión (igual que el
// flujo del ticket, que sí funciona): fuerza al GPS a responder. Si el proveedor
// no responde, usa la última conocida como respaldo para no detener la ruta.
const obtenerPosicion = async (): Promise<Location.LocationObject | null> => {
  try {
    const actual = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("TIMEOUT_GPS")),
          TIMEOUT_UBICACION_MS
        )
      )
    ]);
    console.log(
      `[APP] Fix nuevo obtenido: ${actual.coords.latitude.toFixed(6)}, ${actual.coords.longitude.toFixed(6)}, ts=${actual.timestamp}`
    );
    return actual;
  } catch (error) {
    console.warn(
      "[APP] Sin fix nuevo (se usará la última conocida):",
      (error as Error).message || error
    );
  }

  // Respaldo SOLO si la última conocida es reciente y con buena precisión;
  // de lo contrario se omite el ciclo (mejor un hueco que un salto).
  try {
    const lastKnown = await Location.getLastKnownPositionAsync();
    if (!lastKnown) return null;
    const fresco = Date.now() - lastKnown.timestamp <= FRESCURA_LAST_KNOWN_MS;
    const preciso =
      (lastKnown.coords.accuracy ?? Infinity) <= ACCURACY_MAXIMA_MS;
    if (fresco && preciso) return lastKnown;
    console.warn(
      "[APP] Última posición conocida descartada (no fresca o imprecisa)"
    );
    return null;
  } catch {
    return null;
  }
};

// Registra un punto de ubicación (app abierta)
const registrarPuntoInmediato = async () => {
  const location = await obtenerPosicion();
  if (!location) {
    if (!avisoServiciosGPS) {
      avisoServiciosGPS = true;
      console.warn("Todavía no hay fix de ubicación disponible; se reintentará en el siguiente ciclo.");
    }
    return;
  }

  avisoServiciosGPS = false;
  encolarPunto({
    coords: {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? null
    },
    timestamp: location.timestamp,
    usuarioId: null
  });
};

// Manejador de la tarea en segundo plano (se ejecuta aunque la app esté cerrada).
// No puede usar variables en memoria: lee el usuario desde AsyncStorage.
TaskManager.defineTask(TAREA_UBICACION_FONDO, async ({ data, error }: any) => {
  if (error) {
    console.error("Error en la tarea de ubicación en segundo plano:", error.message || error);
    return;
  }

  const locations = data?.locations;
  if (!locations || locations.length === 0) return;

  const usuarioId = await AsyncStorage.getItem('usuario_id');
  if (!usuarioId) return;

  // El contexto headless puede arrancar sin estado en memoria: se recupera la
  // última referencia aceptada para no aceptar el primer fix de cada lote sin
  // validar (evita el "salto" típico al despertar el GPS).
  if (!ultimoPuntoAceptado) await cargarUltimoPuntoAceptado();

  const lista = Array.isArray(locations) ? locations : [locations];
  for (const location of lista) {
    encolarPunto({
      coords: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? null
      },
      timestamp: location.timestamp,
      usuarioId
    });
  }
  // Mantener viva la tarea hasta que la cola termine de drenarse.
  await esperarColaVacia();
});

// Activa el registro en segundo plano. Solo funciona en un dev build
// (npx expo run:android), no en Expo Go, así que los errores se ignoran.
const iniciarTareaFondo = async () => {
  try {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== 'granted') {
      console.log(
        "Permiso de ubicación en segundo plano denegado: solo se registrará con la app abierta"
      );
      return false;
    }

    await Location.startLocationUpdatesAsync(TAREA_UBICACION_FONDO, {
      accuracy: Location.Accuracy.High,
      distanceInterval: 10,
      timeInterval: INTERVALO_MS,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: "Soporte Campo VPC",
        notificationBody: "Registrando la ruta del técnico",
        notificationColor: "#1976d2"
      }
    });
    return true;
  } catch (error) {
    console.warn(
      "Registro en segundo plano no disponible (se usará solo la app abierta):",
      error
    );
    return false;
  }
};

export const startTracking = async (usuarioId: string): Promise<boolean> => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    console.log('Permiso de ubicación denegado');
    return false;
  }

  if (usuarioIdActual === usuarioId && intervaloForeground) {
    return true;
  }

  await stopTracking();

  console.log(`[APP] startTracking(usuarioId=${usuarioId}), backend=${getBackendUrl()}`);

  usuarioIdActual = usuarioId;
  ultimoEnvio = 0;
  ultimasCoordenadas = null;
  filtroKalman = null;
  ultimoPuntoAceptado = null;
  ultimoTimestampProcesado = null;

  // Si hay una referencia aceptada reciente (misma sesión), se reutiliza para
  // validar el primer punto sin saltos tras arrancar/reconectar.
  await cargarUltimoPuntoAceptado();

  // Registrar un punto al iniciar sesión
  await registrarPuntoInmediato();

  // 1º El muestreo periódico siempre se crea primero y nunca se bloquea:
  // pregunta la posición nueva, así que toma cambios de ubicación automáticamente.
  intervaloForeground = setInterval(async () => {
    if (obteniendoUbicacion) return;
    obteniendoUbicacion = true;
    try {
      await registrarPuntoInmediato();
    } finally {
      obteniendoUbicacion = false;
    }
  }, INTERVALO_MS);

  // Suscripción continua: si el proveedor emite un cambio de ubicación, se envía
  // de inmediato (la regla debeEnviar lo permite porque las coordenadas cambiaron).
  try {
    subscripcionCambios = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 5,
        timeInterval: INTERVALO_MS
      },
      (location) => {
        encolarPunto({
          coords: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy ?? null
          },
          timestamp: location.timestamp,
          usuarioId: null
        });
      }
    );
  } catch (watchError) {
    console.warn("No se pudo activar el seguimiento continuo de cambios:", watchError);
  }

  // 2º Registro en segundo plano: no bloquea el muestreo (requiere dev build)
  void iniciarTareaFondo();

  return true;
};

export const stopTracking = async () => {
  if (subscripcionCambios) {
    subscripcionCambios.remove();
    subscripcionCambios = null;
  }

  if (intervaloForeground) {
    clearInterval(intervaloForeground);
    intervaloForeground = null;
  }

  try {
    if (await TaskManager.isTaskRegisteredAsync(TAREA_UBICACION_FONDO)) {
      await Location.stopLocationUpdatesAsync(TAREA_UBICACION_FONDO);
    }
  } catch (error) {
    console.warn("No se pudo detener el registro en segundo plano:", error);
  }

  usuarioIdActual = null;
  ultimoEnvio = 0;
  ultimasCoordenadas = null;
  filtroKalman = null;
  ultimoPuntoAceptado = null;
  ultimoTimestampProcesado = null;
};