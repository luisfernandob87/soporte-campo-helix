import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ScrollView, ActivityIndicator } from 'react-native'
import React, { useState, useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import axios from 'axios'
import * as Location from 'expo-location'

const DetalleTickets = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    dwpSrid: string;
    type: string;
    incidentNumber: string;
    urgency: string;
    priority: string;
  }>();

  const [resolucion, setResolucion] = useState('');
  const [estadoActual, setEstadoActual] = useState('');
  const [loading, setLoading] = useState(false);
  const [ubicacion, setUbicacion] = useState<{latitude: number; longitude: number} | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const page = "https://servicedesk-dev-is.onbmc.com";
  
  // Estado para controlar qué botones están habilitados
  const [etapaActual, setEtapaActual] = useState<number>(1); // 1: Saliendo a sitio, 2: En sitio, 3: Soporte finalizado, 4: Resolución
  
  // Clave para almacenar el progreso en AsyncStorage
  const getStorageKey = () => `incidente_progreso_${params.incidentNumber}`;
  
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

  // Función para cargar el progreso guardado y consultar WorkLog
  const cargarProgresoYWorkLog = async () => {
    setLoading(true);
    try {
      // Primero intentamos cargar desde AsyncStorage
      const progresoGuardado = await AsyncStorage.getItem(getStorageKey());
      
      if (progresoGuardado) {
        const progreso = JSON.parse(progresoGuardado);
        setEtapaActual(progreso.etapa);
        setEstadoActual(progreso.estado);
        console.log("Progreso cargado desde AsyncStorage:", progreso);
      }
      
      // Luego consultamos la API de WorkLog para verificar el estado actual
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
      
      // Consultar los WorkLogs existentes
      const response = await axios.request({
        url: `${page}/api/arsys/v1/entry/HPD:WorkLog?q=%27Incident%20Number%27%3D%22${params.incidentNumber}%22`,
        method: "GET",
        headers: headersList,
      });
      
      console.log("Respuesta API WorkLog:", JSON.stringify(response.data));
      
      // Analizar los WorkLogs para determinar la etapa actual
      if (response.data && response.data.entries && response.data.entries.length > 0) {
        let ultimaEtapa = 1;
        let ultimoEstado = "";
        
        // Recorremos todos los WorkLogs para encontrar el último estado registrado
        response.data.entries.forEach((entry: any) => {
          const descripcion = entry.values["Detailed Description"] || "";
          
          if (descripcion.includes("Saliendo a sitio")) {
            ultimaEtapa = Math.max(ultimaEtapa, 2);
            ultimoEstado = "Saliendo a sitio";
          } else if (descripcion.includes("En sitio")) {
            ultimaEtapa = Math.max(ultimaEtapa, 3);
            ultimoEstado = "En sitio";
          } else if (descripcion.includes("Soporte finalizado")) {
            ultimaEtapa = Math.max(ultimaEtapa, 4);
            ultimoEstado = "Soporte finalizado";
          } else if (descripcion.includes("Resolución:")) {
            ultimaEtapa = 5; // Completado
            ultimoEstado = "Resolución completada";
          }
        });
        
        // Si la etapa determinada por la API es más avanzada que la guardada localmente, actualizamos
        if (ultimaEtapa > etapaActual) {
          setEtapaActual(ultimaEtapa);
          setEstadoActual(ultimoEstado);
          
          // Guardamos el nuevo progreso en AsyncStorage
          await guardarProgreso(ultimaEtapa, ultimoEstado);
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
  const cambiarEstado = async (nuevoEstado: string, etapa: number) => {
    setLoading(true);
    setEstadoActual(nuevoEstado);
    
    try {
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
      
      // Preparar el cuerpo de la petición
      let bodyContent = JSON.stringify({
        "values": {
          "Incident Number": params.incidentNumber,
          "Work Log Type": "Customer Communication",
          "Detailed Description": descripcion,
          "Secure Work Log": "No",
          "View Access": "Public"
        }
      });
      
      // Realizar la petición a la API
      const response = await axios.request({
        url: `${page}/api/arsys/v1/entry/HPD:WorkLog`,
        method: "POST",
        headers: headersList,
        data: bodyContent,
      });
      
      console.log("Respuesta API:", response.data);
      
      // Actualizar la etapa actual para habilitar el siguiente botón
      const nuevaEtapa = etapa + 1;
      setEtapaActual(nuevaEtapa);
      
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
      
      // Preparar el cuerpo de la petición
      let bodyContent = JSON.stringify({
        "values": {
          "Incident Number": params.incidentNumber,
          "Work Log Type": "Customer Communication",
          "Detailed Description": `Resolución: ${resolucion}`,
          "Secure Work Log": "No",
          "View Access": "Public"
        }
      });
      
      // Realizar la petición a la API
      const response = await axios.request({
        url: `${page}/api/arsys/v1/entry/HPD:WorkLog`,
        method: "POST",
        headers: headersList,
        data: bodyContent,
      });
      
      console.log("Respuesta API Resolución:", response.data);
      
      // Marcar como completado en AsyncStorage
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
        <Text style={styles.infoDetail}>Urgencia: {params.urgency}</Text>
        <Text style={styles.infoDetail}>Prioridad: {params.priority}</Text>
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
        
        <TouchableOpacity 
          style={[
            styles.botonEstado, 
            estadoActual === "Soporte finalizado" ? styles.botonActivo : null,
            etapaActual !== 3 ? styles.botonDeshabilitado : null
          ]} 
          onPress={() => etapaActual === 3 ? cambiarEstado("Soporte finalizado", 3) : null}
          disabled={etapaActual !== 3}
        >
          <Text style={[styles.botonTexto, etapaActual !== 3 ? styles.textoDeshabilitado : null]}>Soporte finalizado</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.resolucionContainer}>
        <Text style={styles.resolucionLabel}>Resolución:</Text>
        <TextInput
          style={[styles.resolucionInput, etapaActual !== 4 ? styles.inputDeshabilitado : null]}
          multiline
          numberOfLines={8}
          placeholder="Ingrese la resolución del caso..."
          value={resolucion}
          onChangeText={setResolucion}
          editable={etapaActual === 4}
        />
        
        <TouchableOpacity 
          style={[styles.guardarButton, etapaActual !== 4 ? styles.botonDeshabilitado : null]} 
          onPress={guardarResolucion}
          disabled={etapaActual !== 4}
        >
          <Text style={[styles.guardarButtonText, etapaActual !== 4 ? styles.textoDeshabilitadoGuardar : null]}>Guardar resolución</Text>
        </TouchableOpacity>
      </View>
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
  botonesContainer: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 16,
    gap: 10,
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
  guardarButton: {
    backgroundColor: '#4caf50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  guardarButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
})