import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native'
import React, { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import axios from 'axios'

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
  const page = "https://servicedesk-dev-is.onbmc.com";

  // Función para manejar el cambio de estado
  const cambiarEstado = async (nuevoEstado: string) => {
    setLoading(true);
    setEstadoActual(nuevoEstado);
    
    try {
      // Obtener token almacenado
      const token = await AsyncStorage.getItem("token");
      
      if (!token) {
        Alert.alert("Error", "No se encontró información de sesión");
        setLoading(false);
        return;
      }
      
      // Aquí se podría implementar la lógica para actualizar el estado en el servidor
      // Por ejemplo, una llamada a la API para actualizar el estado del ticket
      
      Alert.alert("Éxito", `Estado actualizado a: ${nuevoEstado}`);
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
      
      // Aquí se podría implementar la lógica para guardar la resolución en el servidor
      // Por ejemplo, una llamada a la API para actualizar la resolución del ticket
      
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
      </View>
      
      <View style={styles.botonesContainer}>
        <TouchableOpacity 
          style={[styles.botonEstado, estadoActual === "Saliendo a sitio" ? styles.botonActivo : null]} 
          onPress={() => cambiarEstado("Saliendo a sitio")}
        >
          <Text style={styles.botonTexto}>Saliendo a sitio</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.botonEstado, estadoActual === "En sitio" ? styles.botonActivo : null]} 
          onPress={() => cambiarEstado("En sitio")}
        >
          <Text style={styles.botonTexto}>En sitio</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.botonEstado, estadoActual === "Soporte finalizado" ? styles.botonActivo : null]} 
          onPress={() => cambiarEstado("Soporte finalizado")}
        >
          <Text style={styles.botonTexto}>Soporte finalizado</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.resolucionContainer}>
        <Text style={styles.resolucionLabel}>Resolución:</Text>
        <TextInput
          style={styles.resolucionInput}
          multiline
          numberOfLines={8}
          placeholder="Ingrese la resolución del caso..."
          value={resolucion}
          onChangeText={setResolucion}
        />
        
        <TouchableOpacity style={styles.guardarButton} onPress={guardarResolucion}>
          <Text style={styles.guardarButtonText}>Guardar resolución</Text>
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