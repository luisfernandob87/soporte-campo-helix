import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import React, { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { getBackendUrl } from "./services/locationService";
import { useNotificaciones } from "./context/NotificacionesContext";

type Notificacion = {
  notificacion_id: number;
  usuario_id: number;
  mensaje: string;
  estado: string;
  fecha: string;
  datos_ticket?: string | null;
};

const parsearTicket = (datos: string) => {
  try {
    const parsed = JSON.parse(datos);
    if (parsed && parsed.tipo && parsed.requestId) return parsed;
  } catch {
    // datos inválidos: se ignora
  }
  return null;
};

const formatearFecha = (fecha?: string) => {
  if (!fecha) return "";
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
};

export default function NotificacionesScreen() {
  const router = useRouter();
  const { ultima } = useNotificaciones();
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [expandida, setExpandida] = useState<number | null>(
    ultima?.notificacion_id ?? null
  );

  const cargarHistorial = useCallback(async (esRefresh = false) => {
    try {
      const usuarioId = await AsyncStorage.getItem("usuario_id");
      if (!usuarioId) return;
      const res = await fetch(
        `${getBackendUrl()}/notificaciones/historial/${encodeURIComponent(usuarioId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setNotificaciones(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Error al cargar historial de notificaciones:", error);
      if (esRefresh) {
        Alert.alert("Error", "No se pudo actualizar el historial de notificaciones");
      }
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  useEffect(() => {
    cargarHistorial(false);
    const intervalo = setInterval(() => cargarHistorial(true), 30000);
    return () => clearInterval(intervalo);
  }, [cargarHistorial]);

  const renderItem = ({ item }: { item: Notificacion }) => {
    const expandir = expandida === item.notificacion_id;
    const ticket = item.datos_ticket ? parsearTicket(item.datos_ticket) : null;
    const onPress = () => {
      if (ticket) {
        router.push({
          pathname: "/detalleTickets",
          params: {
            id: ticket.requestId,
            dwpSrid: ticket.dwpSrid,
            type: ticket.tipo,
            incidentNumber: ticket.incidentNumber,
            cliente: ticket.cliente,
            priority: ticket.prioridad,
          },
        });
      } else {
        setExpandida(expandir ? null : item.notificacion_id);
      }
    };
    return (
      <TouchableOpacity
        style={[styles.card, expandir && styles.cardExpandida]}
        activeOpacity={0.8}
        onPress={onPress}
      >
        <Text style={styles.fecha}>{formatearFecha(item.fecha)}</Text>
        <Text style={styles.mensaje} numberOfLines={expandir ? undefined : 2}>
          {item.mensaje}
        </Text>
        {ticket ? (
          <Text style={styles.verTicket}>Ver ticket →</Text>
        ) : expandir ? (
          <Text style={styles.verMenos}>Tocar para ocultar</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.contenedor}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.botonAtras}>←</Text>
        </TouchableOpacity>
        <Text style={styles.titulo}>Notificaciones</Text>
      </View>

      {cargando ? (
        <ActivityIndicator size="large" color="#1976d2" style={{ marginTop: 40 }} />
      ) : notificaciones.length === 0 ? (
        <Text style={styles.vacio}>No hay notificaciones.</Text>
      ) : (
        <FlatList
          data={notificaciones}
          keyExtractor={(item) => String(item.notificacion_id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
          refreshing={refrescando}
          onRefresh={() => {
            setRefrescando(true);
            cargarHistorial(true);
          }}
        />
      )}
      <Text style={styles.ayuda}>
        Toca un mensaje para verlo completo o abrir el ticket.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "#1976d2",
  },
  botonAtras: {
    color: "#ffffff",
    fontSize: 24,
    marginRight: 12,
    marginTop: -2,
  },
  titulo: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: "#1976d2",
  },
  cardExpandida: {
    borderLeftColor: "#ff9800",
  },
  fecha: {
    fontSize: 12,
    color: "#888888",
    marginBottom: 4,
  },
  mensaje: {
    fontSize: 14,
    color: "#333333",
    lineHeight: 20,
  },
  verMenos: {
    fontSize: 11,
    color: "#1976d2",
    marginTop: 6,
    fontWeight: "600",
  },
  verTicket: {
    fontSize: 11,
    color: "#1976d2",
    marginTop: 6,
    fontWeight: "700",
  },
  vacio: {
    textAlign: "center",
    marginTop: 60,
    color: "#888888",
    fontSize: 15,
  },
  ayuda: {
    textAlign: "center",
    fontSize: 12,
    color: "#999999",
    paddingVertical: 8,
  },
});