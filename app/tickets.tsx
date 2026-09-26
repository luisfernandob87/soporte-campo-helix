import { StyleSheet, Text, View, ActivityIndicator, Alert, TouchableOpacity } from 'react-native'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import AsyncStorage from "@react-native-async-storage/async-storage"
import axios from "axios"
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router"
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist"
import { Ionicons } from "@expo/vector-icons"
import { getBackendUrl } from "./services/locationService"
import { prioridadFormateada } from "./services/prioridad"

type CaseItem = {
  id: string;
  dwpSrid: string;
  incidentNumber: string;
  cliente: string;
  email: string;
  priority: string;
  type: "ticket" | "workOrder";
  sedeId: number | null;
  visita: number | null;
  sedeNombre: string | null;
  sedeTipo: string | null;
  draggable: boolean;
  _key: string;
};

type SedeRuta = {
  sede_id: number;
  orden: number;
  nombre: string | null;
  correo: string | null;
  tipo: string | null;
};

type RutaHoy = {
  ruta_id: number;
  sedes: SedeRuta[];
};

const normalizarCorreos = (valor: any): string[] =>
  String(valor || "")
    .split(/[;,]/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);

const Tickets = () => {
  const router = useRouter();
  const { groupId, groupName } = useLocalSearchParams<{ groupId: string, groupName: string }>();
  const [items, setItems] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [rutaInfo, setRutaInfo] = useState<RutaHoy | null>(null);
  const [recarga, setRecarga] = useState(0);
  const page = "https://servicedesk-dev-is.onbmc.com";

  const primerValor = (keys: string[], values: any): string =>
    keys.map((k) => values?.[k]).find((v) => v && String(v).trim()) || "";

  const obtenerNombreCliente = (values: any): string => {
    const nombre = primerValor([
      "Customer First Name",
      "First Name",
      "Contact First Name"
    ], values);
    const apellido = primerValor([
      "Customer Last Name",
      "Last Name",
      "Contact Last Name"
    ], values);
    const nombreCompleto = [nombre, apellido].filter(Boolean).join(" ").trim();
    if (nombreCompleto) return nombreCompleto;

    return primerValor(["Customer Name", "Contact Name"], values) || "Sin cliente";
  };

  const obtenerEmailCliente = (values: any): string => {
    return (
      primerValor([
        "Internet E-mail",
        "Customer Internet E-mail",
        "Direct Contact Internet E-mail",
        "Customer E-mail",
        "Contact E-mail",
        "Email"
      ], values) || "Sin correo"
    );
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const storedUsername = await AsyncStorage.getItem("username");
        const token = await AsyncStorage.getItem("token");
        const usuarioId = await AsyncStorage.getItem("usuario_id");

        if (!storedUsername || !token || !groupId) {
          Alert.alert("Error", "Información de sesión incompleta");
          router.back();
          return;
        }

        const headersList = {
          "Accept": "*/*",
          "Authorization": `AR-JWT ${token}`
        };

const ticketsResponse = await axios.request({
          url: `${page}/api/arsys/v1/entry/HPD:IncidentInterface?q=%27Assigned%20Group%20ID%27%3D%22${groupId}%22%20AND%20%27Assignee%20Login%20ID%27%3D%22${storedUsername}%22%20AND%20%27Status%27!%3D%22Resolved%22%20AND%20%27Status%27!%3D%22Closed%22%20AND%20%27Status%27!%3D%22Cancelled%22`,
          method: "GET",
          headers: headersList,
        });

        console.log("Respuesta API Tickets:", JSON.stringify(ticketsResponse.data));

        const ticketsData: CaseItem[] = [];
        if (ticketsResponse.data && ticketsResponse.data.entries) {
          for (const entry of ticketsResponse.data.entries) {
            const idTicket =
              String(entry.values["Incident Number"] || entry.values["Request ID"] || "Sin ID").split("|")[0];
            ticketsData.push({
              id: idTicket,
              dwpSrid: entry.values["DWP_SRID"] || entry.values["SRID"] || "Sin ID de petición",
              incidentNumber: entry.values["Incident Number"] || "Sin número de incidente",
              cliente: obtenerNombreCliente(entry.values),
              email: obtenerEmailCliente(entry.values),
              priority: entry.values["Priority"] || "Estado desconocido",
              type: "ticket",
              sedeId: null,
              visita: null,
              sedeNombre: null,
              sedeTipo: null,
              draggable: false,
              _key: ""
            });
          }
        }

        const workOrdersResponse = await axios.request({
          url: `${page}/api/arsys/v1/entry/WOI:WorkOrder?q=%27ASGRPID%27%3D%22${groupId}%22%20AND%20%27ASLOGID%27%3D%22${storedUsername}%22%20AND%20%27Status%27!%3D%22Completed%22%20AND%20%27Status%27!%3D%22Rejected%22%20AND%20%27Status%27!%3D%22Cancelled%22`,
          method: "GET",
          headers: headersList,
        });

        console.log("Respuesta API Órdenes de Trabajo:", JSON.stringify(workOrdersResponse.data));

        const workOrdersData: CaseItem[] = [];
        if (workOrdersResponse.data && workOrdersResponse.data.entries) {
          for (const entry of workOrdersResponse.data.entries) {
            const idWO =
              String(entry.values["Request ID"] || entry.values["Work Order ID"] || "Sin ID").split("|")[0];
            workOrdersData.push({
              id: idWO,
              dwpSrid: entry.values["DWP_SRID"] || entry.values["SRID"] || "Sin ID de petición",
              incidentNumber: entry.values["Work Order ID"] || "Sin número de orden",
              cliente: obtenerNombreCliente(entry.values),
              email: obtenerEmailCliente(entry.values),
              priority: entry.values["Priority"] || "Sin prioridad",
              type: "workOrder",
              sedeId: null,
              visita: null,
              sedeNombre: null,
              sedeTipo: null,
              draggable: false,
              _key: ""
            });
          }
        }

        let ruta = null as RutaHoy | null;
        if (usuarioId) {
          try {
            const backendUrl = getBackendUrl();
            const rutaResp = await axios.get(`${backendUrl}/usuario/${encodeURIComponent(usuarioId)}/ruta-hoy`);
            if (rutaResp.data && rutaResp.data.sedes) {
              ruta = {
                ruta_id: rutaResp.data.ruta_id,
                sedes: rutaResp.data.sedes as SedeRuta[]
              };
            }
          } catch (error) {
            console.error("Error al cargar la ruta del día:", error);
          }
        }

        // Sede asignada manualmente a cada ticket (portal o "asignar agencia").
        // Son las que coinciden por petición, no por correo. Se cargan todas
        // (sin filtro de técnico) para reflejar también las asignaciones hechas
        // desde el portal aunque el login se guarde con diferencias.
        const mapaGeorefManual = new Map<string, { sede_id: number; nombre: string }>();
        try {
          const backendUrl = getBackendUrl();
          const geoResp = await axios.get(`${backendUrl}/georeferencia/tickets`);
          const geoTickets = Array.isArray(geoResp.data?.tickets) ? geoResp.data.tickets : [];
          for (const geo of geoTickets) {
            if (geo.fuente === "manual" && geo.sede && geo.sede.sede_id) {
              mapaGeorefManual.set(`${geo.tipo}|${geo.requestId}`, {
                sede_id: geo.sede.sede_id,
                nombre: geo.sede.nombre
              });
            }
          }
        } catch (error) {
          console.error("Error al cargar georreferenciación manual:", error);
        }

        const mapaCorreoSede = new Map<string, SedeRuta>();
        if (ruta) {
          for (const sede of ruta.sedes) {
            for (const correo of normalizarCorreos(sede.correo)) {
              if (!mapaCorreoSede.has(correo)) {
                mapaCorreoSede.set(correo, sede);
              }
            }
          }
        }

        const rutaSedesIdx = new Map<number, SedeRuta>(
          (ruta?.sedes ?? []).map((s) => [s.sede_id, s])
        );

        const anotar = (it: CaseItem): CaseItem => {
          const manual = mapaGeorefManual.get(`${it.type}|${it.id}`);
          let coincidencia: SedeRuta | null = null;
          if (manual) {
            const enRuta = rutaSedesIdx.get(manual.sede_id);
            coincidencia = enRuta
              ? enRuta
              : { sede_id: manual.sede_id, orden: 0, nombre: manual.nombre, correo: null, tipo: null };
          } else {
            for (const correo of normalizarCorreos(it.email)) {
              const sede = mapaCorreoSede.get(correo);
              if (sede) {
                coincidencia = sede;
                break;
              }
            }
          }
          return {
            ...it,
            sedeId: coincidencia ? coincidencia.sede_id : null,
            visita: coincidencia && coincidencia.orden ? coincidencia.orden : null,
            sedeNombre: coincidencia ? coincidencia.nombre : null,
            sedeTipo: coincidencia ? coincidencia.tipo || null : null,
            draggable: !!coincidencia && !!coincidencia.orden
          };
        };

        const combinados = [...ticketsData, ...workOrdersData].map(anotar);
        
        // Asignar numeración consecutiva (1 a N) por cada grupo independiente
        const sedesEnGrupo: number[] = [];
        for (const it of combinados) {
          if (it.sedeId != null && !sedesEnGrupo.includes(it.sedeId)) {
            sedesEnGrupo.push(it.sedeId);
          }
        }
        
        // Ordenar las sedes del grupo actual respetando el orden global si existe
        sedesEnGrupo.sort((a, b) => {
          const ordenA = rutaSedesIdx.get(a)?.orden ?? 999;
          const ordenB = rutaSedesIdx.get(b)?.orden ?? 999;
          return ordenA - ordenB;
        });

        // Crear mapa local de visita: 1 a N para el grupo actual
        const mapaVisitaLocal = new Map<number, number>();
        sedesEnGrupo.forEach((sedeId, idx) => {
          mapaVisitaLocal.set(sedeId, idx + 1);
        });

        const combinadosConVisitaLocal = combinados.map((it) => {
          const visitaLocal = it.sedeId != null ? mapaVisitaLocal.get(it.sedeId) ?? null : null;
          return {
            ...it,
            visita: visitaLocal,
            draggable: visitaLocal != null
          };
        });

        const conVisita = combinadosConVisitaLocal
          .filter((it) => it.visita != null)
          .sort((a, b) => (a.visita ?? 0) - (b.visita ?? 0));
        const sinVisita = combinadosConVisitaLocal.filter((it) => it.visita == null);
        const ordenados = [...conVisita, ...sinVisita].map((it, i) => ({
          ...it,
          _key: `${it.type}-${it.id}-${i}`
        }));

        setRutaInfo(ruta);
        setItems(ordenados);
      } catch (error) {
        console.error("Error al obtener datos:", error);
        Alert.alert("Error", "No se pudieron obtener los tickets o las órdenes de trabajo");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [groupId, recarga]);

  const primeraFocalizacion = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraFocalizacion.current) {
        primeraFocalizacion.current = false;
        return;
      }
      setRecarga((r) => r + 1);
    }, [])
  );

  const handleBack = () => {
    router.back();
  };

  const handleTicketPress = (item: CaseItem) => {
    router.push({
      pathname: "/detalleTickets",
      params: {
        id: item.id,
        dwpSrid: item.dwpSrid,
        type: item.type,
        incidentNumber: item.incidentNumber,
        cliente: item.cliente,
        email: item.email,
        priority: item.priority,
        visita: item.visita != null ? String(item.visita) : "",
        sede: item.sedeNombre || ""
      }
    });
  };

  const handleDragEnd = async ({ data }: { data: CaseItem[] }) => {
    if (!rutaInfo) return;
    setItems(data);

    const nuevos: number[] = [];
    for (const it of data) {
      if (it.sedeId != null && !nuevos.includes(it.sedeId)) {
        nuevos.push(it.sedeId);
      }
    }
    if (nuevos.length === 0) return;

    const groupSet = new Set(nuevos);
    const oldIds = rutaInfo.sedes.map((s) => s.sede_id);
    const result: number[] = [];
    let idx = 0;
    for (const oldId of oldIds) {
      if (groupSet.has(oldId)) {
        result.push(nuevos[idx] ?? oldId);
        idx++;
      } else {
        result.push(oldId);
      }
    }
    for (const id of nuevos) {
      if (!result.includes(id)) result.push(id);
    }

    setGuardando(true);
    try {
      const backendUrl = getBackendUrl();
      await axios.put(
        `${backendUrl}/ruta/${rutaInfo.ruta_id}`,
        { sedes: result },
        { headers: { "Content-Type": "application/json" } }
      );

      const ordenMap = new Map(result.map((id, i) => [id, i + 1]));
      const sedesMap = new Map(rutaInfo.sedes.map((s) => [s.sede_id, s]));
      
      // Re-mapear la numeración local consecutiva de 1 a N de acuerdo al nuevo ordenamiento
      const nuevasSedesEnGrupo: number[] = [];
      data.forEach((it) => {
        if (it.sedeId != null && !nuevasSedesEnGrupo.includes(it.sedeId)) {
          nuevasSedesEnGrupo.push(it.sedeId);
        }
      });
      
      const nuevoMapaVisitaLocal = new Map<number, number>();
      nuevasSedesEnGrupo.forEach((sedeId, idx) => {
        nuevoMapaVisitaLocal.set(sedeId, idx + 1);
      });

      setItems((prev) =>
        prev.map((it) => {
          if (it.sedeId == null) return it;
          const nuevoOrdenLocal = nuevoMapaVisitaLocal.get(it.sedeId);
          return {
            ...it,
            visita: nuevoOrdenLocal ?? it.visita,
            sedeNombre: sedesMap.get(it.sedeId)?.nombre ?? it.sedeNombre
          };
        })
      );
      const nuevasSedes: SedeRuta[] = result.map((id, i) => {
        const previo = sedesMap.get(id);
        return previo
          ? { ...previo, sede_id: id, orden: i + 1 }
          : { sede_id: id, orden: i + 1, nombre: null, correo: null, tipo: null };
      });
      setRutaInfo((prev) => (prev ? { ...prev, sedes: nuevasSedes } : prev));
    } catch (error) {
      console.error("Error al guardar el nuevo orden:", error);
      Alert.alert("Error", "No se pudo guardar el nuevo orden de visitas");
      const ordenMap = new Map(rutaInfo.sedes.map((s) => [s.sede_id, s.orden]));
      setItems((prev) =>
        prev
          .slice()
          .sort((a, b) => {
            const oa = a.sedeId != null ? ordenMap.get(a.sedeId) ?? Infinity : Infinity;
            const ob = b.sedeId != null ? ordenMap.get(b.sedeId) ?? Infinity : Infinity;
            return oa - ob;
          })
      );
    } finally {
      setGuardando(false);
    }
  };

  const irAAsignar = (item: CaseItem) => {
    router.push({
      pathname: "/asignarSede",
      params: {
        tipo: item.type,
        requestId: item.id,
        dwpSrid: item.dwpSrid,
        sedeId: item.sedeId != null ? String(item.sedeId) : "",
        groupId: groupId || "",
        groupName: groupName || "",
      },
    });
  };

  const renderItem = ({ item, drag, isActive }: RenderItemParams<CaseItem>) => {
    const esTicket = item.type === "ticket";
    return (
      <View style={[styles.card, esTicket ? styles.cardTicket : styles.cardWO, isActive && styles.cardActive]}>
        {item.visita != null ? (
          <View style={[styles.visitaBadge, esTicket ? styles.visitaTicket : styles.visitaWO]}>
            <Text style={styles.visitaLabel}>Visita</Text>
            <Text style={styles.visitaNumero}>{item.visita}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.cardBody} onPress={() => handleTicketPress(item)} activeOpacity={0.7}>
          <Text style={[styles.tipoBadge, { color: esTicket ? "#1976d2" : "#2e7d32" }]}>
            {esTicket ? "● INCIDENTE" : "● ORDEN DE TRABAJO"}
          </Text>
          <Text style={styles.ticketTitle}>ID de Petición: {item.dwpSrid}</Text>
          <Text style={styles.ticketSubtitle}>
            {esTicket ? `Número de Incidente: ${item.incidentNumber}` : `Número de Orden: ${item.incidentNumber}`}
          </Text>
          <Text style={styles.ticketSummary}>Cliente: {item.cliente}</Text>
          <Text style={styles.ticketEmail}>Correo: {item.email}</Text>
          {item.sedeNombre ? (
            <Text style={styles.ticketSede}>Sede: {item.sedeNombre}</Text>
          ) : (
            <Text style={styles.ticketSinSede}>Sin sede asignada</Text>
          )}
          <Text style={[styles.ticketStatus, { color: prioridadFormateada(item.priority).color }]}>
            Prioridad: {prioridadFormateada(item.priority).label}
          </Text>
        </TouchableOpacity>

        {item.draggable ? (
          <TouchableOpacity style={styles.dragHandle} onLongPress={drag} onPress={() => {}} delayLongPress={250}>
            <Text style={styles.dragHandleIcon}>≡</Text>
            <Text style={styles.dragHandleText}>ordenar</Text>
          </TouchableOpacity>
        ) : null}

        {String(item.sedeTipo || '').toLowerCase() !== 'super 24' && (
          <TouchableOpacity
            style={styles.geoBtn}
            onPress={() => irAAsignar(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="location-outline" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const hayRuta = rutaInfo !== null;
  const conDraggable = items.some((it) => it.draggable);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{groupName}</Text>
      </View>

      {guardando ? (
        <View style={styles.avisoFila}>
          <ActivityIndicator size="small" color="#1976d2" />
          <Text style={styles.avisoTexto}>Guardando nuevo orden…</Text>
        </View>
      ) : hayRuta && conDraggable ? (
        <Text style={styles.aviso}>
          Toca la tarjeta para ver el detalle. Mantén presionado ≡ para reordenar las visitas.
        </Text>
      ) : !hayRuta ? (
        <Text style={[styles.aviso, styles.avisoPendiente]}>
          La ruta del día aún no se genera. La ordena automáticamente en unos minutos; vuelve a entrar o tira para refrescar.
        </Text>
      ) : null}

      {loading ? (
        <ActivityIndicator size="large" color="#1976d2" style={styles.loader} />
      ) : items.length > 0 ? (
        <DraggableFlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item._key}
          onDragEnd={handleDragEnd}
          containerStyle={styles.ticketsListContainer}
          style={styles.ticketsList}
          contentContainerStyle={styles.ticketsListContent}
          activationDistance={12}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No tienes tickets ni órdenes de trabajo asignados en este grupo</Text>
        </View>
      )}
    </View>
  )
}

export default Tickets

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
    flex: 1,
  },
  aviso: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#e3f2fd',
    color: '#0d47a1',
    fontSize: 12,
    textAlign: 'center',
  },
  avisoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: '#e3f2fd',
    gap: 8,
  },
  avisoTexto: {
    color: '#0d47a1',
    fontSize: 12,
  },
  avisoPendiente: {
    backgroundColor: '#fff3e0',
    color: '#e65100',
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ticketsListContainer: {
    flex: 1,
  },
  ticketsList: {
    flex: 1,
  },
  ticketsListContent: {
    padding: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  cardTicket: {
    borderLeftWidth: 4,
    borderLeftColor: '#1976d2',
  },
  cardWO: {
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
  },
  cardActive: {
    backgroundColor: '#fafafa',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  visitaBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  visitaTicket: {
    backgroundColor: '#1976d2',
  },
  visitaWO: {
    backgroundColor: '#4caf50',
  },
  visitaLabel: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  visitaNumero: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  cardBody: {
    flex: 1,
  },
  tipoBadge: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  ticketTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  ticketSubtitle: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
  },
  ticketSummary: {
    fontSize: 14,
    marginBottom: 8,
  },
  ticketEmail: {
    fontSize: 13,
    color: '#1976d2',
    marginBottom: 8,
  },
  ticketSede: {
    fontSize: 13,
    color: '#2e7d32',
    fontWeight: '600',
    marginBottom: 8,
  },
  ticketSinSede: {
    fontSize: 13,
    color: '#9e9e9e',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  ticketStatus: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  geoBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1976d2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandle: {
    width: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginLeft: 8,
    marginTop: 32,
  },
  dragHandleIcon: {
    fontSize: 26,
    color: '#757575',
  },
  dragHandleText: {
    fontSize: 9,
    color: '#9e9e9e',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
})