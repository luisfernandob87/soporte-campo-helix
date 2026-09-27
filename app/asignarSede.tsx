import { StyleSheet, Text, View, ActivityIndicator, Alert, TouchableOpacity, FlatList } from 'react-native'
import React, { useState, useEffect } from 'react'
import AsyncStorage from "@react-native-async-storage/async-storage"
import axios from "axios"
import { useLocalSearchParams, useRouter } from "expo-router"
import { getBackendUrl } from "./services/locationService"

type Agencia = {
  sede_id: number;
  nombre: string;
  direccion: string;
  correo: string;
};

const AsignarSede = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{
    tipo: string;
    requestId: string;
    dwpSrid: string;
    sedeId: string;
    groupId: string;
    groupName: string;
    // Opcionales: los envía el alta de incidente para que, tras guardar la sede,
    // la pantalla siga al detalle del caso en vez de volver atrás.
    incidentNumber?: string;
    cliente?: string;
    email?: string;
    priority?: string;
    continuarA?: string;
  }>();

  const [agencias, setAgencias] = useState<Agencia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [seleccion, setSeleccion] = useState<number | null>(null);

  const backendUrl = getBackendUrl();

  useEffect(() => {
    const cargar = async () => {
      try {
        const resp = await axios.get(`${backendUrl}/sedes`);
        const lista = Array.isArray(resp.data)
          ? resp.data.filter(
              (s: any) =>
                String(s.tipo).toLowerCase() === "agencia" &&
                String(s.status).toLowerCase() === "activo" &&
                String(s.tipo).toLowerCase() !== "super 24"
            )
          : [];
        setAgencias(lista);
        const actual = params.sedeId ? Number(params.sedeId) : null;
        if (actual != null && lista.some((a: any) => a.sede_id === actual)) {
          setSeleccion(actual);
        }
      } catch (error) {
        console.error("Error al cargar agencias:", error);
        Alert.alert("Error", "No se pudieron cargar las agencias");
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, [backendUrl, params.sedeId]);

  const sedeSeleccionada = seleccion != null
    ? agencias.find((a) => a.sede_id === seleccion)
    : null;

  const guardar = async () => {
    if (seleccion == null) {
      Alert.alert("Sin selección", "Elige una agencia antes de guardar");
      return;
    }
    setGuardando(true);
    try {
      const storedUsername = await AsyncStorage.getItem("username");
      await axios.put(`${backendUrl}/georeferencia/ticket`, {
        tipo: params.tipo,
        request_id: params.requestId,
        sede_id: seleccion,
        usuario: storedUsername,
      });
      Alert.alert("Listo", `Agencia asignada a ${params.dwpSrid}`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      // Si viene del alta de incidente, se sigue al detalle para registrar la
      // visita; si no, se comporta como siempre y sólo vuelve atrás.
      if (params.continuarA === "detalle" && params.incidentNumber) {
        router.replace({
          pathname: "/detalleTickets",
          params: {
            id: params.incidentNumber,
            dwpSrid: params.dwpSrid,
            type: params.tipo,
            incidentNumber: params.incidentNumber,
            cliente: params.cliente || "",
            email: params.email || "",
            priority: params.priority || "",
            sede: sedeSeleccionada ? sedeSeleccionada.nombre : "",
            // El caso se acaba de crear, así que su "Volver" no debe regresar al
            // formulario: se va a la lista del grupo donde ya quedó el caso.
            volverA: "tickets",
            groupId: params.groupId,
            groupName: params.groupName,
          },
        });
        return;
      }
      router.back();
    } catch (error) {
      console.error("Error al asignar agencia:", error);
      Alert.alert("Error", "No se pudo asignar la agencia. Intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  const seleccionar = (a: Agencia) => {
    if (guardando) return;
    setSeleccion(a.sede_id);
  };

  const renderAgencia = ({ item }: { item: Agencia }) => {
    const marcada = seleccion === item.sede_id;
    return (
      <TouchableOpacity
        style={[styles.agenciaItem, marcada && styles.agenciaItemSel]}
        onPress={() => seleccionar(item)}
      >
        <View style={[styles.radio, marcada && styles.radioSel]}>
          {marcada ? <View style={styles.radioPunto} /> : null}
        </View>
        <View style={styles.agenciaTexto}>
          <Text style={[styles.agenciaNombre, marcada && styles.agenciaNombreSel]}>
            {item.nombre}
          </Text>
          {item.direccion ? (
            <Text style={styles.agenciaDir}>{item.direccion}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Asignar agencia</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>{params.dwpSrid}</Text>
        <Text style={styles.infoSub}>
          Sede actual: {sedeSeleccionada ? sedeSeleccionada.nombre : "Sin sede asignada"}
        </Text>
      </View>

      {cargando ? (
        <ActivityIndicator size="large" color="#1976d2" style={styles.loader} />
      ) : agencias.length === 0 ? (
        <View style={styles.vacio}>
          <Text style={styles.vacioText}>No hay agencias disponibles</Text>
        </View>
      ) : (
        <FlatList
          data={agencias}
          keyExtractor={(a) => String(a.sede_id)}
          renderItem={renderAgencia}
          contentContainerStyle={styles.lista}
        />
      )}

      <View style={styles.pie}>
        <TouchableOpacity
          style={[styles.botonGuardar, seleccion == null && styles.botonGuardarOff]}
          onPress={guardar}
          disabled={guardando}
        >
          {guardando ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.botonGuardarText}>Guardar selección</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default AsignarSede;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1976d2',
    paddingTop: 50,
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
    flexShrink: 1,
  },
  infoCard: {
    margin: 12,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1976d2',
    marginBottom: 4,
  },
  infoSub: {
    fontSize: 13,
    color: '#666',
  },
  loader: {
    marginTop: 40,
  },
  vacio: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  vacioText: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
  },
  lista: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  agenciaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 12,
    marginBottom: 8,
  },
  agenciaItemSel: {
    borderColor: '#1976d2',
    backgroundColor: '#eef4fd',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#9e9e9e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  radioSel: {
    borderColor: '#1976d2',
  },
  radioPunto: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1976d2',
  },
  agenciaTexto: {
    flex: 1,
  },
  agenciaNombre: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  agenciaNombreSel: {
    color: '#1976d2',
  },
  agenciaDir: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  pie: {
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderColor: '#e0e0e0',
  },
  botonGuardar: {
    backgroundColor: '#1976d2',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  botonGuardarOff: {
    backgroundColor: '#b0bec5',
  },
  botonGuardarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});