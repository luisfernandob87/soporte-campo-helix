import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import React, { useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import axios from 'axios'
import { useRouter } from 'expo-router'
import { getBackendUrl } from './services/locationService'

type TicketSinSede = {
  tipo: string;
  requestId: string;
  dwpSrid: string;
  cliente: string;
  prioridad: string;
  fuente: string;
  tecnico: string;
};

type Agencia = {
  sede_id: number;
  nombre: string;
  direccion: string;
};

const ETIQUETA_TIPO: Record<string, string> = {
  ticket: 'Ticket',
  workOrder: 'Orden',
};

const asignarAgencia = () => {
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [tickets, setTickets] = useState<TicketSinSede[]>([]);
  const [agencias, setAgencias] = useState<Agencia[]>([]);
  const [seleccion, setSeleccion] = useState<Record<string, number>>({});
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const backendUrl = getBackendUrl();
      const username = await AsyncStorage.getItem('username');
      if (!username) {
        Alert.alert('Error', 'No se encontró tu sesión. Vuelve a iniciar sesión.');
        router.back();
        return;
      }

      const [geoResponse, sedesResponse] = await Promise.all([
        axios.get(`${backendUrl}/georeferencia/tickets`, {
          params: { tecnico: username },
        }),
        axios.get(`${backendUrl}/sedes`),
      ]);

      const todos: TicketSinSede[] = Array.isArray(geoResponse.data?.tickets)
        ? geoResponse.data.tickets
        : [];
      setTickets(todos.filter((t) => t.fuente === 'sin georreferenciar'));

      const agenciasList: Agencia[] = Array.isArray(sedesResponse.data)
        ? sedesResponse.data.filter(
            (s: any) => s.tipo === 'Agencia' && String(s.status).toLowerCase() === 'activo'
          )
        : [];
      setAgencias(agenciasList);
    } catch (error) {
      console.error('Error al cargar tickets sin sede:', error);
      Alert.alert('Error', 'No se pudieron cargar tus tickets. Revisa tu conexión.');
    } finally {
      setCargando(false);
    }
  }, [router]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const asignar = async (t: TicketSinSede) => {
    const clave = `${t.tipo}|${t.requestId}`;
    const sedeId = seleccion[clave];
    if (!sedeId) {
      Alert.alert('Aviso', 'Selecciona una agencia primero.');
      return;
    }
    setGuardando(clave);
    try {
      const backendUrl = getBackendUrl();
      const username = await AsyncStorage.getItem('username');
      if (!username) {
        Alert.alert('Error', 'No se encontró tu sesión. Vuelve a iniciar sesión.');
        router.back();
        return;
      }
      await axios.put(`${backendUrl}/georeferencia/ticket`, {
        tipo: t.tipo,
        request_id: t.requestId,
        sede_id: sedeId,
        usuario: t.tecnico || username,
      });
      setTickets((prev) => prev.filter((x) => `${x.tipo}|${x.requestId}` !== clave));
      setSeleccion((prev) => {
        const next = { ...prev };
        delete next[clave];
        return next;
      });
      Alert.alert('Listo', 'La agencia se asignó a tu ticket.');
    } catch (error: any) {
      console.error('Error al asignar agencia:', error);
      Alert.alert('Error', error?.response?.data?.message || 'No se pudo asignar la agencia.');
    } finally {
      setGuardando(null);
    }
  };

  const renderTicket = ({ item }: { item: TicketSinSede }) => {
    const clave = `${item.tipo}|${item.requestId}`;
    return (
      <View style={styles.ticketItem}>
        <View style={styles.ticketHeader}>
          <Text style={[styles.tipoBadge, item.tipo === 'workOrder' ? styles.tipoOrden : styles.tipoTicket]}>
            {ETIQUETA_TIPO[item.tipo] || item.tipo}
          </Text>
          <Text style={styles.requestId}>{item.requestId}</Text>
        </View>
        <Text style={styles.cliente}>{item.cliente || 'Sin cliente'}</Text>
        <Text style={styles.sub}>
          {item.dwpSrid} · Prioridad: {item.prioridad || '—'}
        </Text>

        <View style={styles.filaAccion}>
          <View style={styles.select}>
            {agencias.map((a) => (
              <AgenciaOption
                key={a.sede_id}
                nombre={a.nombre}
                seleccionada={seleccion[clave] === a.sede_id}
                onPress={() =>
                  setSeleccion((prev) => ({ ...prev, [clave]: a.sede_id }))
                }
              />
            ))}
            {agencias.length === 0 && (
              <Text style={styles.sinAgencias}>No hay agencias registradas.</Text>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.boton, guardando === clave && styles.botonDeshabilitado]}
          disabled={guardando === clave || !seleccion[clave]}
          onPress={() => asignar(item)}
        >
          <Text style={styles.botonTexto}>
            {guardando === clave ? 'Guardando...' : 'Asignar agencia'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.titulo}>Mis tickets sin sede</Text>
      </View>

      <Text style={styles.descripcion}>
        Estos son tus tickets abiertos que aún no tienen sede o agencia asignada. Al
        asignarles una agencia, se geolocalizan y aparecen en tu ruta del día. Los tickets
        cerrados desaparecen de la lista.
      </Text>

      {cargando ? (
        <Text style={styles.vacio}>Cargando tus tickets...</Text>
      ) : tickets.length === 0 ? (
        <Text style={styles.vacio}>No tienes tickets sin sede asignada. ¡Todo listo!</Text>
      ) : (
        <FlatList
          data={tickets}
          renderItem={renderTicket}
          keyExtractor={(item) => `${item.tipo}|${item.requestId}`}
          contentContainerStyle={styles.lista}
        />
      )}
    </View>
  );
};

const AgenciaOption = ({
  nombre,
  seleccionada,
  onPress,
}: {
  nombre: string;
  seleccionada: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity style={styles.agenciaItem} onPress={onPress}>
    <View style={styles.radio}>{seleccionada && <View style={styles.radioInterior} />}</View>
    <Text style={styles.agenciaTexto}>{nombre}</Text>
  </TouchableOpacity>
);

export default asignarAgencia;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  backText: {
    fontSize: 26,
    color: '#1976d2',
  },
  titulo: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  descripcion: {
    fontSize: 14,
    color: '#555',
    marginBottom: 16,
  },
  lista: {
    paddingBottom: 12,
  },
  vacio: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
    marginTop: 24,
  },
  ticketItem: {
    backgroundColor: '#f4f6f8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    marginBottom: 12,
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  tipoBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
  },
  tipoTicket: {
    backgroundColor: '#e0f2fe',
    color: '#0369a1',
  },
  tipoOrden: {
    backgroundColor: '#ede9fe',
    color: '#6d28d9',
  },
  requestId: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  cliente: {
    fontSize: 15,
    color: '#333',
    marginBottom: 2,
  },
  sub: {
    fontSize: 12,
    color: '#888',
    marginBottom: 10,
  },
  filaAccion: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  select: {
    flex: 1,
  },
  agenciaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#888',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInterior: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1976d2',
  },
  agenciaTexto: {
    fontSize: 13,
    color: '#333',
    flex: 1,
  },
  sinAgencias: {
    fontSize: 13,
    color: '#b45309',
    fontStyle: 'italic',
  },
  boton: {
    backgroundColor: '#1976d2',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  botonTexto: {
    color: '#fff',
    fontWeight: '600',
  },
  botonDeshabilitado: {
    opacity: 0.5,
  },
});