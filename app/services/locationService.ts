import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import axios from 'axios';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Puerto donde corre el backend local
const BACKEND_PORT = 4000;

// Sobrescribir con la URL fija del backend si se despliega (por ejemplo, en Render)
const OVERRIDE_BACKEND_URL = '';

// Frecuencia de muestreo (30 s para pruebas, luego ajustar a 60 s)
const INTERVALO_MS = 30 * 1000;
// Máximo tiempo de espera para obtener un fix nuevo de ubicación
const TIMEOUT_UBICACION_MS = 20000;

// Nombre de la tarea que registra ubicación estando la app en segundo plano
const TAREA_UBICACION_FONDO = 'ubicacion-en-fondo';

export const getBackendUrl = (): string => {
  if (OVERRIDE_BACKEND_URL) return OVERRIDE_BACKEND_URL;
  // En desarrollo (Expo Go / build de dev), usa la IP del host del servidor Metro,
  // que es la misma máquina donde corre el backend, para que funcione en el dispositivo.
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:${BACKEND_PORT}` : `http://localhost:${BACKEND_PORT}`;
};

let intervaloForeground: ReturnType<typeof setInterval> | null = null;
let subscripcionCambios: Location.LocationSubscription | null = null;
let usuarioIdActual: string | null = null;
let ultimoEnvio: number = 0;
let avisoServiciosGPS = false;
let obteniendoUbicacion = false;
let ultimasCoordenadas: { latitude: number; longitude: number } | null = null;

// Regla de envío (1 punto por cambio real o por cadencia, nunca duplicados):
// - `bloqueoEnvioHasta` reserva (síncronamente) el derecho de enviar el próximo
//   MIN_INTERVALO_ENVIO_MS ms: si dos flujos (muestreo y suscripción) evalúan
//   casi al mismo tiempo, solo el primero pasa.
// - después, se envía si pasó la cadencia (usuario quieto, ruta continua) o si
//   el punto cambió de verdad (movimiento).
const MIN_INTERVALO_ENVIO_MS = 8000;
const EPSILON_MISMO_PUNTO = 0.0002;

let bloqueoEnvioHasta = 0;

const mismoPunto = (coords: { latitude: number; longitude: number }): boolean => {
  if (!ultimasCoordenadas) return false;
  return (
    Math.abs(coords.latitude - ultimasCoordenadas.latitude) <= EPSILON_MISMO_PUNTO &&
    Math.abs(coords.longitude - ultimasCoordenadas.longitude) <= EPSILON_MISMO_PUNTO
  );
};

const debeEnviar = (coords: { latitude: number; longitude: number }): boolean => {
  const ahora = Date.now();
  // Ya se decidió un envío hace menos de MIN_INTERVALO_ENVIO_MS ms → no duplicar.
  if (ahora < bloqueoEnvioHasta) return false;

  const enCadencia = !ultimoEnvio || ahora - ultimoEnvio >= INTERVALO_MS - 4000;
  if (enCadencia || !mismoPunto(coords)) {
    bloqueoEnvioHasta = ahora + MIN_INTERVALO_ENVIO_MS;
    return true;
  }
  return false;
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

  try {
    return await Location.getLastKnownPositionAsync();
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
  const coords = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? null
  };
  if (!debeEnviar(coords)) return;
  await enviarUbicacion(coords, null);
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

  for (const location of Array.isArray(locations) ? locations : [locations]) {
    const coords = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? null
    };
    if (!debeEnviar(coords)) continue;
    await enviarUbicacion(coords, usuarioId);
  }
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
      accuracy: Location.Accuracy.Balanced,
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
        const coords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy ?? null
        };
        if (!debeEnviar(coords)) return;
        enviarUbicacion(coords, null);
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
};