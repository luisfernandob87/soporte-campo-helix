import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ScrollView, ActivityIndicator } from 'react-native'
import React, { useState, useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import axios from 'axios'
import * as Location from 'expo-location'
import { getBackendUrl } from './services/locationService'
import { prioridadFormateada } from './services/prioridad'

// Límite de espera de las peticiones. Sin un timeout explícito, axios espera
// indefinidamente: si Helix o el backend se bloquean, el await no resuelve y el
// setLoading(false) del finally nunca corre, dejando la pantalla inutilizable.
const TIMEOUT_HELIX_MS = 30000;
const TIMEOUT_BACKEND_MS = 15000;

// Estados con los que un caso ya no se considera abierto. Se usan para detectar
// los casos que quedaron marcados como completados en la app pero que nunca
// llegaron a cerrarse en Helix.
const ESTADOS_FINALES = [
  'Resolved',
  'Closed',
  'Completed',
  'Cancelled',
  'Rejected',
];

// Helix añade un asterisco a los estados que tienen cambios pendientes de
// procesar ("Resolved*"). Comparar sin normalizar haría creer que el caso sigue
// abierto y borraría una resolución que sí se guardó.
const normalizarEstadoHelix = (estado: string) =>
  String(estado ?? '')
    .trim()
    .replace(/\*+$/, '')
    .trim();

// Texto con el que la app escribe la resolución en el Work Log. Es la única
// señal de que el técnico ya terminó el caso.
const PREFIJO_RESOLUCION = 'Resolución:';

// Texto con el que la app escribe la nota de pendiente. Además de documentar el
// caso, reinicia el flujo: el técnico puede volver a registrar la visita.
const PREFIJO_PENDIENTE = 'Nota del pendiente:';

// Estado en Helix para un caso que quedó pendiente. No es un estado final, así
// que el caso sigue apareciendo en la lista del técnico y en la ruta del día.
const ESTADO_PENDIENTE = 'Pending';

// Motivo de estado que acompaña al Pending. Los dos formularios lo exigen: sin él
// Helix rechaza la actualización con un 500 ("The Status Reason field requires a
// value when the status is either pending or resolved"). Cada formulario lo
// nombra distinto, así que va aparte del estado.
const MOTIVO_PENDIENTE = 'Client Action Required';
const CAMPO_MOTIVO_ESTADO = {
  ticket: 'Status_Reason',
  workOrder: 'Status Reason',
} as const;

// Texto que devuelve Helix cuando rechaza una actualización. Es la única pista
// útil si el PUT falla (motivo de estado obligatorio, combinación inválida, usuario
// no registrado...) y evita tener que andar leyendo la consola.
const mensajeErrorHelix = (error: any): string => {
  const respuesta = error?.response?.data;
  const texto = Array.isArray(respuesta)
    ? (respuesta[0]?.messageAppendedText || respuesta[0]?.messageText)
    : (respuesta?.messageAppendedText || respuesta?.messageText);
  return texto || error?.message || 'error desconocido';
};

const DetalleTickets = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    dwpSrid: string;
    type: string;
    incidentNumber: string;
    cliente: string;
    email: string;
    priority: string;
    visita: string;
    sede: string;
  }>();

  const [resolucion, setResolucion] = useState('');
  const [notaPendiente, setNotaPendiente] = useState('');
  const [modoPendiente, setModoPendiente] = useState(false);
  const [estadoActual, setEstadoActual] = useState('');
  const [loading, setLoading] = useState(false);
  const [ubicacion, setUbicacion] = useState<{latitude: number; longitude: number} | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const page = "https://servicedesk-dev-is.onbmc.com";
  const backendUrl = getBackendUrl();
  
  // Estado para controlar qué botones están habilitados
  const [etapaActual, setEtapaActual] = useState<number>(1); // 1: Saliendo a sitio, 2: En sitio, 3: Soporte finalizado, 4: Resolución
  
  // Clave para almacenar el progreso en AsyncStorage
  const getStorageKey = () => params.type === "ticket" 
    ? `incidente_progreso_${params.incidentNumber}` 
    : `orden_progreso_${params.incidentNumber}`;
  
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permiso de ubicación denegado');
        return;
      }
    })();
    
    // Cargar el progreso guardado y consultar WorkLog
    cargarProgresoYWorkLog();
  }, []);

  // Función para obtener la ubicación actual
  const obtenerUbicacion = async () => {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      setUbicacion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      });
      return location.coords;
    } catch (error) {
      console.error("Error al obtener ubicación:", error);
      setErrorMsg('Error al obtener ubicación');
      return null;
    }
  };

  // Función para cargar el progreso guardado y consultar WorkLog o WorkInfo
  const cargarProgresoYWorkLog = async () => {
    setLoading(true);
    // Etapa más avanzada conocida entre lo guardado en el dispositivo y lo que
    // dicen los Work Logs. Se lleva aparte porque el estado de React todavía
    // vale 1 dentro de esta función al montarse por primera vez.
    let etapaEfectiva = 1;
    // Momento en que se guardó ese progreso local. Se contrasta con la fecha de
    // la última nota de pendiente para saber si el reinicio es más nuevo.
    let etapaGuardadaEn = 0;
    try {
      // Primero intentamos cargar desde AsyncStorage
      const progresoGuardado = await AsyncStorage.getItem(getStorageKey());
      
      if (progresoGuardado) {
        const progreso = JSON.parse(progresoGuardado);
        setEtapaActual(progreso.etapa);
        setEstadoActual(progreso.estado);
        etapaEfectiva = Number(progreso.etapa) || 1;
        const guardadoEn = Date.parse(String(progreso.timestamp || ''));
        etapaGuardadaEn = isNaN(guardadoEn) ? 0 : guardadoEn;
        console.log("Progreso cargado desde AsyncStorage:", progreso);
      }
      
      // Luego consultamos la API correspondiente para verificar el estado actual
      const token = await AsyncStorage.getItem("token");
      
      if (!token) {
        Alert.alert("Error", "No se encontró información de sesión");
        return;
      }
      
      // Configurar los headers para la petición
      let headersList = {
        "Accept": "*/*",
        "Authorization": `AR-JWT ${token}`
      };
      
      let response;
      
      if (params.type === "ticket") {
        // Consultar los WorkLogs existentes para tickets
        response = await axios.request({
          url: `${page}/api/arsys/v1/entry/HPD:WorkLog?q=%27Incident%20Number%27%3D%22${params.incidentNumber}%22`,
          method: "GET",
          headers: headersList,
          timeout: TIMEOUT_HELIX_MS,
        });
        
        console.log("Respuesta API WorkLog:", JSON.stringify(response.data));
      } else {
        // Consultar los WorkInfo existentes para órdenes de trabajo
        response = await axios.request({
            url: `${page}/api/arsys/v1/entry/WOI:WorkInfo?q=%27Work%20Order%20ID%27%3D%22${params.incidentNumber}%22`,
            method: "GET",
            headers: headersList,
            timeout: TIMEOUT_HELIX_MS,
          });
        
        console.log("Respuesta API WorkInfo:", JSON.stringify(response.data));
      }
      
      // Analizar las entradas para determinar la etapa actual
      if (response.data && response.data.entries && response.data.entries.length > 0) {
        // Se recorren en orden cronológico porque la última marca que se
        // reconoce es la que manda: la nota de pendiente reinicia el flujo, así
        // que solo cuentan las entradas posteriores a ella.
        const fechaMarca = (entry: any) => {
          const v = entry.values || {};
          const crudo = v['Work Log Date'] || v['Work Log Submit Date'] || v['Submit Date'] || '';
          const ms = Date.parse(String(crudo));
          return isNaN(ms) ? 0 : ms;
        };
        const ordenadas = [...response.data.entries].sort((a: any, b: any) => fechaMarca(a) - fechaMarca(b));

        let ultimaEtapa = 1;
        let ultimoEstado = "";
        let fechaUltimoPendiente = 0;

        ordenadas.forEach((entry: any) => {
          const descripcion = String(entry.values["Detailed Description"] || "");
          // Solo cuentan las notas que escribió la app, que siempre empiezan por
          // la frase. Así se ignoran los Work Logs que genera Helix (Assigned To:,
          // Status Marked:, Priority Marked:) y también una nota redactada por
          // otra persona que mencione la frase dentro de un párrafo, por ejemplo
          // "el cliente no se encuentra En sitio".
          if (descripcion.startsWith(PREFIJO_PENDIENTE)) {
            ultimaEtapa = 1;
            ultimoEstado = "Pendiente registrado";
            fechaUltimoPendiente = fechaMarca(entry);
          } else if (descripcion.startsWith(PREFIJO_RESOLUCION)) {
            ultimaEtapa = 5; // Completado
            ultimoEstado = "Resolución completada";
          } else if (descripcion.startsWith("Soporte finalizado")) {
            ultimaEtapa = 4;
            ultimoEstado = "Soporte finalizado";
          } else if (descripcion.startsWith("En sitio")) {
            ultimaEtapa = 3;
            ultimoEstado = "En sitio";
          } else if (descripcion.startsWith("Saliendo a sitio")) {
            ultimaEtapa = 2;
            ultimoEstado = "Saliendo a sitio";
          }
        });

        // La etapa guardada en el dispositivo solo se supera hacia adelante. La
        // excepción es una nota de pendiente más reciente que ese guardado: ahí el
        // reinicio sí debe aplicarse aunque la etapa guardada fuera mayor, o el
        // técnico no podría volver a registrar la visita.
        if (ultimaEtapa > etapaEfectiva || fechaUltimoPendiente > etapaGuardadaEn) {
          etapaEfectiva = ultimaEtapa;
          setEtapaActual(ultimaEtapa);
          setEstadoActual(ultimoEstado);
          setModoPendiente(false);
          await guardarProgreso(ultimaEtapa, ultimoEstado);
        }
      }
      
      // Rescate de casos que quedaron marcados como completados en la app pero
      // que nunca llegaron a cerrarse en Helix. En ese estado el caso reaparece
      // en la lista con el formulario y el botón deshabilitados, sin forma de
      // volver a guardarlo desde la app.
      if (etapaEfectiva >= 5) {
        const urlEstado = params.type === "ticket"
          ? `${page}/api/arsys/v1/entry/HPD:Help%20Desk?q=%27Incident%20Number%27%3D%22${params.incidentNumber}%22&fields=values(Status)`
          : `${page}/api/arsys/v1/entry/WOI:WorkOrder?q=%27Work%20Order%20ID%27%3D%22${params.incidentNumber}%22&fields=values(Status)`;

        let estadoHelix = '';
        try {
          const estadoResponse = await axios.request({
            url: urlEstado,
            method: "GET",
            headers: headersList,
            timeout: TIMEOUT_HELIX_MS,
          });

          const entradas = estadoResponse.data?.entries;
          if (Array.isArray(entradas) && entradas.length > 0) {
            estadoHelix = String(entradas[0].values?.Status || '').trim();
          }
        } catch (error) {
          // Si no se puede confirmar el estado en Helix no se toca la etapa: es
          // preferible dejar el caso como está antes que reabrir uno que ya
          // quedó cerrado correctamente.
          console.log("No se pudo confirmar el estado en Helix; se conserva la etapa.");
          return;
        }

        if (estadoHelix && !ESTADOS_FINALES.includes(normalizarEstadoHelix(estadoHelix))) {
          console.log(
            `Rescate: etapa 5 local pero estado "${estadoHelix}" en Helix. Se vuelve a la etapa 4.`
          );
          await AsyncStorage.removeItem(getStorageKey());
          setEtapaActual(4);
          setEstadoActual('Cierre no confirmado en Remedy');
          Alert.alert(
            'Cierre no confirmado',
            'Este caso quedó marcado como completado en la app, pero en Remedy sigue ' +
            `abierto (estado: ${estadoHelix}). Se habilitó el guardado para que puedas reintentarlo.`
          );
        }
      }
    } catch (error) {
      console.error("Error al cargar progreso:", error);
    } finally {
      setLoading(false);
    }
  };
  
  // Función para guardar el progreso en AsyncStorage
  const guardarProgreso = async (etapa: number, estado: string) => {
    try {
      const progreso = {
        etapa,
        estado,
        timestamp: new Date().toISOString()
      };
      await AsyncStorage.setItem(getStorageKey(), JSON.stringify(progreso));
      console.log("Progreso guardado:", progreso);
    } catch (error) {
      console.error("Error al guardar progreso:", error);
    }
  };
  
  // Función para manejar el cambio de estado
  const actualizarUbicacionUsuario = async () => {
    try {
      // Obtener el nombre de usuario almacenado
      const storedUsername = await AsyncStorage.getItem('username');
      if (!storedUsername) {
        console.error('No se encontró el nombre de usuario almacenado');
        return;
      }

      // Obtener la lista de usuarios del backend
      const backendUsers = await axios.get(`${backendUrl}/usuarios`, {
        timeout: TIMEOUT_BACKEND_MS,
      });
      if (!Array.isArray(backendUsers.data)) {
        console.error('Error: La respuesta del backend no es un array', backendUsers.data);
        return;
      }

      // Buscar el usuario en la lista
      const existingUser = backendUsers.data.find((user) => user.usuario === storedUsername);
      if (!existingUser) {
        console.error('Usuario no encontrado en el backend');
        return;
      }

      // Obtener el ID del usuario
      const userId = existingUser.usuario_id || existingUser.id || existingUser._id;
      if (!userId) {
        console.error('Error: Usuario existente no tiene ID válido', existingUser);
        return;
      }

      // Solicitar permisos de ubicación
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Permiso de ubicación denegado');
        return;
      }

      // Obtener la ubicación actual
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });

      // Actualizar la ubicación en el backend
      const updateUrl = `${backendUrl}/usuario/${userId}`;
      await axios.put(updateUrl, {
        latitud: location.coords.latitude,
        longitud: location.coords.longitude
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: TIMEOUT_BACKEND_MS,
      });

      console.log('Ubicación actualizada exitosamente');
    } catch (error) {
      console.error('Error al actualizar ubicación:', error);
    }
  };

  const cambiarEstado = async (nuevoEstado: string, etapa: number) => {
    setLoading(true);
    setEstadoActual(nuevoEstado);

    try {
      // La ubicación se actualiza dentro del try: si el GPS o el backend fallan
      // el error cae en el catch común en vez de dejar la pantalla en carga
      // infinita. La actualización de ubicación nunca debe impedir registrar
      // el cambio de estado, por eso su propio fallo se ignora.
      await actualizarUbicacionUsuario();

      // Obtener ubicación actual
      const coords = await obtenerUbicacion();
      
      // Obtener token almacenado
      const token = await AsyncStorage.getItem("token");
      
      if (!token) {
        Alert.alert("Error", "No se encontró información de sesión");
        setLoading(false);
        return;
      }
      
      // Preparar la descripción con las coordenadas
      let descripcion = `${nuevoEstado}`;
      if (coords) {
        descripcion += ` - Latitud: ${coords.latitude}, Longitud: ${coords.longitude}`;
      } else {
        descripcion += " - No se pudo obtener la ubicación";
      }
      
      // Configurar los headers para la petición
      let headersList = {
        "Accept": "*/*",
        "Authorization": `AR-JWT ${token}`,
        "Content-Type": "application/json" 
      };
      
      let bodyContent;
      let url;
      
      if (params.type === "ticket") {
        // Preparar el cuerpo de la petición para tickets
        bodyContent = JSON.stringify({
          "values": {
            "Incident Number": params.incidentNumber,
            "Work Log Type": "Customer Communication",
            "Detailed Description": descripcion,
            "Secure Work Log": "No",
            "View Access": "Public"
          }
        });
        
        url = `${page}/api/arsys/v1/entry/HPD:WorkLog`;
      } else {
        // Preparar el cuerpo de la petición para órdenes de trabajo
        bodyContent = JSON.stringify({
          "values": {
            "Work Order ID": params.incidentNumber,
            "Detailed Description": descripcion,
            "Short Description": `Actualización: ${nuevoEstado}`,
            "View Access": "Public"
          }
        });
        
        url = `${page}/api/arsys/v1/entry/WOI:WorkInfo`;
      }
      
      // Realizar la petición a la API
      const response = await axios.request({
        url: url,
        method: "POST",
        headers: headersList,
        data: bodyContent,
        timeout: TIMEOUT_HELIX_MS,
      });
      
      console.log("Respuesta API:", response.data);
      
      // Actualizar la etapa actual para habilitar el siguiente botón
      const nuevaEtapa = etapa + 1;
      setEtapaActual(nuevaEtapa);
      // El flujo vuelve por la vía normal: se sale del modo pendiente para que el
      // formulario no mezclara la nota con la resolución.
      setModoPendiente(false);
      setNotaPendiente('');
      
      // Guardar el progreso en AsyncStorage
      await guardarProgreso(nuevaEtapa, nuevoEstado);
      
      if (coords) {
        Alert.alert("Éxito", `Estado actualizado a: ${nuevoEstado}\nLatitud: ${coords.latitude}\nLongitud: ${coords.longitude}`);
      } else {
        Alert.alert("Éxito", `Estado actualizado a: ${nuevoEstado}\nNo se pudo obtener la ubicación`);
      }
    } catch (error) {
      console.error("Error al cambiar estado:", error);
      Alert.alert("Error", "No se pudo actualizar el estado");
    } finally {
      setLoading(false);
    }
  };

  // Función para guardar la resolución
  const guardarResolucion = async () => {
    if (resolucion.trim() === '') {
      Alert.alert("Error", "Por favor ingrese una resolución");
      return;
    }
    
    setLoading(true);

    try {
      // Dentro del try por el mismo motivo que en cambiarEstado: un fallo al
      // actualizar la ubicación no debe dejar la pantalla colgada ni impedir
      // guardar la resolución.
      await actualizarUbicacionUsuario();

      // Obtener token almacenado
      const token = await AsyncStorage.getItem("token");
      
      if (!token) {
        Alert.alert("Error", "No se encontró información de sesión");
        setLoading(false);
        return;
      }
      
      // Configurar los headers para la petición
      let headersList = {
        "Accept": "*/*",
        "Authorization": `AR-JWT ${token}`,
        "Content-Type": "application/json" 
      };
      
      let bodyContent;
      let url;
      
      if (params.type === "ticket") {
        // Preparar el cuerpo de la petición para tickets
        bodyContent = JSON.stringify({
          "values": {
            "Incident Number": params.incidentNumber,
            "Work Log Type": "Customer Communication",
            "Detailed Description": `${PREFIJO_RESOLUCION} ${resolucion}`,
            "Secure Work Log": "No",
            "View Access": "Public"
          }
        });
        
        url = `${page}/api/arsys/v1/entry/HPD:WorkLog`;
      } else {
        // Preparar el cuerpo de la petición para órdenes de trabajo
        bodyContent = JSON.stringify({
          "values": {
            "Work Order ID": params.incidentNumber,
            "Detailed Description": `${PREFIJO_RESOLUCION} ${resolucion}`,
            "Short Description": "Resolución del caso",
            "View Access": "Public"
          }
        });
        
        url = `${page}/api/arsys/v1/entry/WOI:WorkInfo`;
      }
      
      // Realizar la petición a la API
      const response = await axios.request({
        url: url,
        method: "POST",
        headers: headersList,
        data: bodyContent,
        timeout: TIMEOUT_HELIX_MS,
      });
      
      console.log("Respuesta API Resolución:", response.data);
      
      // Actualizar el estado según el tipo (ticket o work order). Se registra si
      // el cierre llegó a Helix: si falla, la app no debe avanzar a la etapa 5,
      // porque eso dejaba el caso marcado como completado con el ticket abierto
      // y sin forma de reintentar desde la app.
      let estadoActualizado = false;
      let motivoFallo = '';

      if (params.type === "ticket") {
        try {
          // 1. Primero consultar el Entry ID del incidente
          const incidentResponse = await axios.request({
            url: `${page}/api/arsys/v1/entry/HPD:Help%20Desk?q=%27Incident%20Number%27%3D%22${params.incidentNumber}%22`,
            method: "GET",
            headers: headersList,
            timeout: TIMEOUT_HELIX_MS,
          });
          
          console.log("Respuesta API Incidente:", JSON.stringify(incidentResponse.data));
          
          // Verificar si se encontró el incidente y obtener su Entry ID
          if (incidentResponse.data && 
              incidentResponse.data.entries && 
              incidentResponse.data.entries.length > 0) {
            
            const entryId = incidentResponse.data.entries[0].values["Entry ID"];
            
            if (entryId) {
              // 2. Actualizar el estado del incidente a Resolved
              const updateResponse = await axios.request({
                url: `${page}/api/arsys/v1/entry/HPD:Help%20Desk/${entryId}`,
                method: "PUT",
                headers: headersList,
                data: JSON.stringify({
                  "values": {
                    "Status": "Resolved",
                    "Resolution": resolucion,
                    "Status_Reason": "Automated Resolution Reported"
                  }
                }),
                timeout: TIMEOUT_HELIX_MS,
              });
              
              estadoActualizado = true;
              console.log("Respuesta API Actualización Estado Incidente:", JSON.stringify(updateResponse.data));
            } else {
              motivoFallo = 'no se encontró el registro del incidente en Helix';
              console.error(motivoFallo);
            }
          } else {
            motivoFallo = 'no se encontró el incidente';
            console.error(motivoFallo);
          }
        } catch (updateError: any) {
          const detalle = mensajeErrorHelix(updateError);
          motivoFallo = `Helix rechazó el cierre del incidente (${detalle})`;
          console.error("Error al actualizar estado del incidente:", updateError?.response?.data || updateError);
        }
      } else {
        // Si es una orden de trabajo, actualizar su estado a Completed
        try {
          // 1. Primero consultar el Request ID de la orden de trabajo
          const workOrderResponse = await axios.request({
            url: `${page}/api/arsys/v1/entry/WOI:WorkOrder?q=%27Work%20Order%20ID%27%3D%22${params.incidentNumber}%22`,
            method: "GET",
            headers: headersList,
            timeout: TIMEOUT_HELIX_MS,
          });
          
          console.log("Respuesta API Orden de Trabajo:", JSON.stringify(workOrderResponse.data));
          
          // Verificar si se encontró la orden de trabajo y obtener su Request ID
          if (workOrderResponse.data && 
              workOrderResponse.data.entries && 
              workOrderResponse.data.entries.length > 0) {
            
            const requestId = workOrderResponse.data.entries[0].values["Request ID"];
            
            if (requestId) {
              // 2. Actualizar el estado de la orden de trabajo a Completed
              const updateResponse = await axios.request({
                url: `${page}/api/arsys/v1/entry/WOI:WorkOrder/${requestId}`,
                method: "PUT",
                headers: headersList,
                data: JSON.stringify({
                  "values": {
                    "Status": "Completed",
                    "chr_Resolution": resolucion,
                    // El motivo de estado se envía vacío a propósito. Si la orden
                    // quedó antes en Pending con un motivo, ese motivo no está
                    // asociado a Completed y Helix rechaza el cierre con 500
                    // ("Status is not associated with the status reason"). Vacío
                    // queda la combinación Completed sin motivo, que es la que
                    // usan las órdenes cerradas por la app.
                    "Status Reason": ""
                  }
                }),
                timeout: TIMEOUT_HELIX_MS,
              });
              
              estadoActualizado = true;
              console.log("Respuesta API Actualización Estado Orden de Trabajo:", JSON.stringify(updateResponse.data));
            } else {
              motivoFallo = 'no se encontró el identificador de la orden de trabajo';
              console.error(motivoFallo);
            }
          } else {
            motivoFallo = 'no se encontró la orden de trabajo';
            console.error(motivoFallo);
          }
        } catch (updateError: any) {
          const detalle = mensajeErrorHelix(updateError);
          motivoFallo = `Helix rechazó el cierre de la orden de trabajo (${detalle})`;
          console.error("Error al actualizar estado de la orden de trabajo:", updateError?.response?.data || updateError);
        }
      }
      
      if (!estadoActualizado) {
        // La resolución quedó en el Work Log, pero el estado no se actualizó. Se
        // mantiene la etapa 4 para que el botón siga activo y el técnico pueda
        // reintentar; avanzar a la 5 dejaba el caso sin salida desde la app.
        const detalle = motivoFallo || 'la actualización no se completó';
        console.log(`Cierre no confirmado (${detalle}). Se conserva la etapa 4 para reintentar.`);
        Alert.alert(
          "Cierre no confirmado",
          `La resolución se guardó, pero el estado del caso no se actualizó: ${detalle}.\n\n` +
          "El caso sigue abierto en Remedy. Toca 'Guardar resolución' para reintentar."
        );
        return;
      }
      
      // Solo con el cierre confirmado en Helix se marca el caso como completado.
      await guardarProgreso(5, "Resolución completada");
      
      Alert.alert("Éxito", "Resolución guardada correctamente", [
        { text: "OK", onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error("Error al guardar resolución:", error);
      Alert.alert("Error", "No se pudo guardar la resolución");
    } finally {
      setLoading(false);
    }
  };

  // Pasa el formulario a modo pendiente. No avanza la etapa: el técnico todavía
  // puede cancelar y registrar el soporte como finalizado.
  const cambiarModoPendiente = (activo: boolean) => {
    if (activo) {
      setNotaPendiente('');
    }
    setModoPendiente(activo);
  };

  // Registra la nota del pendiente: la escribe en la Actividad del caso, lo deja
  // en estado Pending en Helix y reinicia el flujo para que el técnico pueda
  // volver a registrar la visita.
  const registrarPendiente = async () => {
    if (notaPendiente.trim() === '') {
      Alert.alert("Error", "Por favor ingrese la nota del pendiente");
      return;
    }

    setLoading(true);

    try {
      // Dentro del try por el mismo motivo que en cambiarEstado: un fallo al
      // actualizar la ubicación no debe dejar la pantalla colgada ni impedir
      // registrar la nota.
      await actualizarUbicacionUsuario();

      // Obtener token almacenado
      const token = await AsyncStorage.getItem("token");

      if (!token) {
        Alert.alert("Error", "No se encontró información de sesión");
        return;
      }

      const headersList = {
        "Accept": "*/*",
        "Authorization": `AR-JWT ${token}`,
        "Content-Type": "application/json"
      };

      const descripcion = `${PREFIJO_PENDIENTE} ${notaPendiente.trim()}`;

      let bodyContent;
      let url;

      if (params.type === "ticket") {
        bodyContent = JSON.stringify({
          "values": {
            "Incident Number": params.incidentNumber,
            "Work Log Type": "Customer Communication",
            "Detailed Description": descripcion,
            "Secure Work Log": "No",
            "View Access": "Public"
          }
        });

        url = `${page}/api/arsys/v1/entry/HPD:WorkLog`;
      } else {
        bodyContent = JSON.stringify({
          "values": {
            "Work Order ID": params.incidentNumber,
            "Detailed Description": descripcion,
            "Short Description": "Nota del pendiente",
            "View Access": "Public"
          }
        });

        url = `${page}/api/arsys/v1/entry/WOI:WorkInfo`;
      }

      await axios.request({
        url: url,
        method: "POST",
        headers: headersList,
        data: bodyContent,
        timeout: TIMEOUT_HELIX_MS,
      });

      console.log("Respuesta API Nota del pendiente: registrada");

      // El estado solo se cambia si la nota quedó escrita. Se actualiza al
      // Pending sin tocar Resolution / chr_Resolution: el caso no se cerró, solo
      // quedó pendiente de una nueva visita.
      let estadoActualizado = false;
      let motivoFallo = '';

      try {
        const esTicket = params.type === "ticket";
        const form = esTicket ? "HPD:Help%20Desk" : "WOI:WorkOrder";
        const campoQuery = esTicket ? "Incident Number" : "Work Order ID";
        const campoId = esTicket ? "Entry ID" : "Request ID";
        const query = `'${campoQuery}'="${params.incidentNumber}"`;

        const casoResponse = await axios.request({
          url: `${page}/api/arsys/v1/entry/${form}?q=${encodeURIComponent(query)}`,
          method: "GET",
          headers: headersList,
          timeout: TIMEOUT_HELIX_MS,
        });

        const idCaso = casoResponse.data?.entries?.[0]?.values?.[campoId];

        if (idCaso) {
          const updateResponse = await axios.request({
            url: `${page}/api/arsys/v1/entry/${form}/${idCaso}`,
            method: "PUT",
            headers: headersList,
            data: JSON.stringify({
              "values": {
                "Status": ESTADO_PENDIENTE,
                [CAMPO_MOTIVO_ESTADO[esTicket ? "ticket" : "workOrder"]]: MOTIVO_PENDIENTE
              }
            }),
            timeout: TIMEOUT_HELIX_MS,
          });

          estadoActualizado = true;
          console.log("Respuesta API Actualización Estado Pendiente:", JSON.stringify(updateResponse.data));
        } else {
          motivoFallo = esTicket
            ? 'no se encontró el registro del incidente en Helix'
            : 'no se encontró el identificador de la orden de trabajo';
          console.error(motivoFallo);
        }
      } catch (updateError: any) {
        const detalleHelix = mensajeErrorHelix(updateError);
        console.error(
          "Error al actualizar estado a pendiente:",
          JSON.stringify(updateError?.response?.data) || updateError?.message || updateError
        );
        motivoFallo = `Helix rechazó el cambio de estado (${detalleHelix})`;
      }

      if (!estadoActualizado) {
        // La nota quedó en la Actividad, pero el estado no se actualizó. Se
        // conserva la etapa 3 para que el botón siga activo y el técnico pueda
        // reintentar; reiniciar el flujo sin el estado en Pending dejaría el caso
        // con la misma apariencia en la app y en la lista.
        const detalle = motivoFallo || 'la actualización no se completó';
        console.log(`Estado pendiente no confirmado (${detalle}). Se conserva la etapa 3 para reintentar.`);
        Alert.alert(
          "Estado no confirmado",
          `La nota se guardó en la Actividad, pero el caso no quedó en estado pendiente: ${detalle}.\n\n` +
          "El caso sigue como estaba en Remedy. Toca 'Registrar pendiente' para reintentar."
        );
        return;
      }

      // El flujo vuelve al inicio para que el técnico pueda registrar otra visita.
      setModoPendiente(false);
      setNotaPendiente('');
      setEtapaActual(1);
      setEstadoActual('Pendiente registrado');
      await guardarProgreso(1, 'Pendiente registrado');

      Alert.alert(
        "Éxito",
        "Nota del pendiente guardada. El caso quedó en estado pendiente.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (error) {
      console.error("Error al registrar la nota del pendiente:", error);
      Alert.alert("Error", "No se pudo registrar la nota del pendiente");
    } finally {
      setLoading(false);
    }
  };

  // El formulario aparece cuando el técnico ya decidió: al registrar el soporte
  // como finalizado (paso 4) o al dejar el caso pendiente (modo pendiente, que se
  // elige en el paso 3). En el paso 5 se mantiene visible, en solo lectura, para
  // poder leer lo que se resolvió.
  const mostrarFormulario = modoPendiente || etapaActual >= 4;

  // El formulario se usa en dos momentos distintos: la resolución se escribe en
  // el paso 4, pero la nota del pendiente se elige en el paso 3 sin avanzar el
  // flujo, así que también tiene que ser editable ahí. El paso 4 manda siempre:
  // si el técnico pulsa "Soporte finalizado" estando en modo pendiente, el
  // formulario no puede quedar bloqueado.
  const formularioEditable = etapaActual === 4 || (modoPendiente && etapaActual === 3);

  const handleBack = () => {
    router.back();
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {params.type === "ticket" ? "Incidente" : "Orden de Trabajo"}
        </Text>
      </View>
      
      <View style={styles.infoContainer}>
        <Text style={styles.infoTitle}>ID de Petición: {params.dwpSrid}</Text>
        <Text style={styles.infoDetail}>
          {params.type === "ticket" ? "Número de Incidente" : "Número de Orden"}: {params.incidentNumber}
        </Text>
        <Text style={styles.infoDetail}>Cliente: {params.cliente}</Text>
        {params.visita && params.visita !== "0" ? (
          <Text style={styles.visitaOrden}>
            {params.visita}ª visita · Sede: {params.sede}
          </Text>
        ) : null}
        {params.email && params.email !== "Sin correo" ? (
          <Text style={styles.infoDetail}>Correo del cliente: {params.email}</Text>
        ) : null}
        <Text style={[styles.infoDetail, { color: prioridadFormateada(params.priority).color }]}>
          Prioridad: {prioridadFormateada(params.priority).label}
        </Text>
        {estadoActual ? <Text style={styles.estadoActual}>Estado actual: {estadoActual}</Text> : null}
        {ubicacion ? (
          <View style={styles.ubicacionContainer}>
            <Text style={styles.ubicacionTitle}>Ubicación actual:</Text>
            <Text style={styles.ubicacionDetail}>Latitud: {ubicacion.latitude}</Text>
            <Text style={styles.ubicacionDetail}>Longitud: {ubicacion.longitude}</Text>
          </View>
        ) : errorMsg ? (
          <Text style={styles.errorText}>{errorMsg}</Text>
        ) : null}
      </View>
      
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1976d2" />
          <Text style={styles.loadingText}>Procesando...</Text>
        </View>
      )}
      
      {/* Barra de progreso */}
      <View style={styles.progressBarContainer}>
        <View style={styles.progressBarLabels}>
          <Text style={[styles.progressLabel, etapaActual >= 1 ? styles.progressLabelActive : null]}>Inicio</Text>
          <Text style={[styles.progressLabel, etapaActual >= 2 ? styles.progressLabelActive : null]}>Saliendo</Text>
          <Text style={[styles.progressLabel, etapaActual >= 3 ? styles.progressLabelActive : null]}>En sitio</Text>
          <Text style={[styles.progressLabel, etapaActual >= 4 ? styles.progressLabelActive : null]}>Finalizado</Text>
          <Text style={[styles.progressLabel, etapaActual >= 5 ? styles.progressLabelActive : null]}>Resuelto</Text>
        </View>
        <View style={styles.progressBarBackground}>
          <View style={[styles.progressBarFill, { width: `${(etapaActual - 1) * 25}%` }]} />
        </View>
        <View style={styles.progressBarSteps}>
          <View style={[styles.progressStep, etapaActual >= 1 ? styles.progressStepCompleted : null]} />
          <View style={[styles.progressStep, etapaActual >= 2 ? styles.progressStepCompleted : null]} />
          <View style={[styles.progressStep, etapaActual >= 3 ? styles.progressStepCompleted : null]} />
          <View style={[styles.progressStep, etapaActual >= 4 ? styles.progressStepCompleted : null]} />
          <View style={[styles.progressStep, etapaActual >= 5 ? styles.progressStepCompleted : null]} />
        </View>
      </View>
      
      <View style={styles.botonesContainer}>
        <TouchableOpacity 
          style={[
            styles.botonEstado, 
            estadoActual === "Saliendo a sitio" ? styles.botonActivo : null,
            etapaActual !== 1 ? styles.botonDeshabilitado : null
          ]} 
          onPress={() => etapaActual === 1 ? cambiarEstado("Saliendo a sitio", 1) : null}
          disabled={etapaActual !== 1}
        >
          <Text style={[styles.botonTexto, etapaActual !== 1 ? styles.textoDeshabilitado : null]}>Saliendo a sitio</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.botonEstado, 
            estadoActual === "En sitio" ? styles.botonActivo : null,
            etapaActual !== 2 ? styles.botonDeshabilitado : null
          ]} 
          onPress={() => etapaActual === 2 ? cambiarEstado("En sitio", 2) : null}
          disabled={etapaActual !== 2}
        >
          <Text style={[styles.botonTexto, etapaActual !== 2 ? styles.textoDeshabilitado : null]}>En sitio</Text>
        </TouchableOpacity>
        
        {/* "Soporte finalizado" y "Pendiente" compiten entre sí: registrar la
            nota de pendiente no avanza la etapa, solo cambia el formulario que
            se muestra abajo. */}
        <View style={styles.botonesFila}>
          <TouchableOpacity 
            style={[
              styles.botonEstado, 
              styles.botonFila,
              estadoActual === "Soporte finalizado" ? styles.botonActivo : null,
              etapaActual !== 3 ? styles.botonDeshabilitado : null
            ]} 
            onPress={() => etapaActual === 3 ? cambiarEstado("Soporte finalizado", 3) : null}
            disabled={etapaActual !== 3}
          >
            <Text style={[styles.botonTexto, etapaActual !== 3 ? styles.textoDeshabilitado : null]}>Soporte finalizado</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[
              styles.botonEstado,
              styles.botonFila,
              styles.botonPendiente,
              modoPendiente ? styles.botonPendienteActivo : null,
              etapaActual !== 3 ? styles.botonDeshabilitado : null
            ]} 
            onPress={() => etapaActual === 3 ? cambiarModoPendiente(true) : null}
            disabled={etapaActual !== 3}
          >
            <Text style={[styles.botonTexto, styles.textoBotonPendiente, etapaActual !== 3 ? styles.textoDeshabilitado : null]}>Pendiente</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {/* El formulario no aparece hasta que el técnico decide qué hacer con el
          caso: registrar el soporte como finalizado o dejarlo pendiente. En el
          paso 5 se sigue viendo, ya en solo lectura, para que se lea lo que
          se resolvió. */}
      {mostrarFormulario && (
        <View style={styles.resolucionContainer}>
          <Text style={styles.resolucionLabel}>
            {modoPendiente ? "Nota del pendiente:" : "Resolución:"}
          </Text>
          <TextInput
            style={[styles.resolucionInput, !formularioEditable ? styles.inputDeshabilitado : null]}
            multiline
            numberOfLines={8}
            placeholder={modoPendiente ? "Ingrese la nota del pendiente..." : "Ingrese la resolución del caso..."}
            value={modoPendiente ? notaPendiente : resolucion}
            onChangeText={modoPendiente ? setNotaPendiente : setResolucion}
            editable={formularioEditable}
          />

          {modoPendiente && (
            <TouchableOpacity
              style={[styles.cancelarButton, !formularioEditable ? styles.botonDeshabilitado : null]}
              onPress={() => cambiarModoPendiente(false)}
              disabled={!formularioEditable}
            >
              <Text style={[styles.cancelarButtonText, !formularioEditable ? styles.textoDeshabilitado : null]}>Cancelar</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity 
            style={[
              styles.guardarButton,
              modoPendiente ? styles.guardarPendiente : null,
              !formularioEditable ? styles.botonDeshabilitado : null
            ]} 
            onPress={modoPendiente ? registrarPendiente : guardarResolucion}
            disabled={!formularioEditable}
          >
            <Text style={[styles.guardarButtonText, !formularioEditable ? styles.textoDeshabilitadoGuardar : null]}>
              {modoPendiente ? "Registrar pendiente" : "Guardar resolución"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

export default DetalleTickets

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  progressBarContainer: {
    padding: 16,
    marginBottom: 10,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1976d2',
    borderRadius: 4,
  },
  progressBarSteps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -12,
  },
  progressStep: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
    borderWidth: 2,
    borderColor: '#fff',
  },
  progressStepCompleted: {
    backgroundColor: '#1976d2',
  },
  progressBarLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  progressLabel: {
    fontSize: 12,
    color: '#757575',
    textAlign: 'center',
  },
  progressLabelActive: {
    color: '#1976d2',
    fontWeight: 'bold',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    zIndex: 1000,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#1976d2',
  },
  ubicacionContainer: {
    marginTop: 12,
    padding: 8,
    backgroundColor: '#e3f2fd',
    borderRadius: 4,
  },
  ubicacionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#0d47a1',
  },
  ubicacionDetail: {
    fontSize: 14,
    color: '#1565c0',
  },
  errorText: {
    marginTop: 8,
    color: '#d32f2f',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1976d2',
    paddingTop: 50, // Para evitar el notch en iOS
  },
  backButton: {
    marginRight: 10,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
  },
  infoContainer: {
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    margin: 16,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  infoDetail: {
    fontSize: 16,
    marginBottom: 4,
    color: '#555',
  },
  estadoActual: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 8,
    color: '#1976d2',
  },
  visitaOrden: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#2e7d32',
  },
  botonesContainer: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 16,
    gap: 10,
  },
  botonesFila: {
    flexDirection: 'row',
    gap: 10,
  },
  botonFila: {
    flex: 1,
  },
  // Ámbar siempre: el texto va en blanco y sobre el gris del resto de botones
  // no se leería. El contorno marca que el formulario está en modo pendiente.
  botonPendiente: {
    backgroundColor: '#ef6c00',
  },
  botonPendienteActivo: {
    backgroundColor: '#e65100',
    borderWidth: 2,
    borderColor: '#bf360c',
  },
  textoBotonPendiente: {
    color: '#fff',
  },
  botonEstado: {
    backgroundColor: '#e0e0e0',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  botonActivo: {
    backgroundColor: '#1976d2',
  },
  botonTexto: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  botonDeshabilitado: {
    backgroundColor: '#f0f0f0',
    opacity: 0.6,
  },
  textoDeshabilitado: {
    color: '#999',
  },
  textoDeshabilitadoGuardar: {
    color: '#fff',
    opacity: 0.6,
  },
  inputDeshabilitado: {
    backgroundColor: '#f0f0f0',
    opacity: 0.6,
  },
  resolucionContainer: {
    padding: 16,
    marginBottom: 20,
  },
  resolucionLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  resolucionInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    textAlignVertical: 'top',
    minHeight: 150,
    fontSize: 16,
  },
  cancelarButton: {
    backgroundColor: '#e0e0e0',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  cancelarButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  guardarButton: {
    backgroundColor: '#4caf50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  guardarPendiente: {
    backgroundColor: '#ef6c00',
  },
  guardarButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
})