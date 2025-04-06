import { StyleSheet, Text, View, FlatList, ActivityIndicator, Alert, TouchableOpacity, SectionList } from 'react-native'
import React, { useState, useEffect } from 'react'
import AsyncStorage from "@react-native-async-storage/async-storage"
import axios from "axios"
import { useLocalSearchParams, useRouter } from "expo-router"

const Tickets = () => {
  const router = useRouter();
  const { groupId, groupName } = useLocalSearchParams<{ groupId: string, groupName: string }>();
  const [tickets, setTickets] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const page = "https://servicedesk-dev-is.onbmc.com";

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Obtener el nombre de usuario y token almacenados
        const storedUsername = await AsyncStorage.getItem("username");
        const token = await AsyncStorage.getItem("token");
        
        if (!storedUsername || !token || !groupId) {
          Alert.alert("Error", "Información de sesión incompleta");
          router.back();
          return;
        }
        
        setUsername(storedUsername);
        
        // Configurar los headers para la petición
        const headersList = {
          "Accept": "*/*",
          "Authorization": `AR-JWT ${token}`
        };
        
        // Hacer la petición a la API para obtener los tickets asignados
        const ticketsResponse = await axios.request({
          url: `${page}/api/arsys/v1/entry/HPD:Help%20Desk?q=%27Assigned%20Group%20ID%27%3D%22${groupId}%22%20AND%20%27Assignee%20Login%20ID%27%3D%22${storedUsername}%22%20AND%27Status%27!%3D%22Resolved%22%20AND%20%27Status%27!%3D%22Closed%22%20AND%20%27Status%27!%3D%22Cancelled%22`,
          method: "GET",
          headers: headersList,
        });
        
        console.log("Respuesta API Tickets:", JSON.stringify(ticketsResponse.data));
        
        // Extraer los tickets de la respuesta
        if (ticketsResponse.data && ticketsResponse.data.entries) {
          const ticketsData = ticketsResponse.data.entries.map((entry: any) => ({
            id: entry.values["Request ID"] || "Sin ID",
            dwpSrid: entry.values["DWP_SRID"] || "Sin ID de petición",
            incidentNumber: entry.values["Incident Number"] || "Sin número de incidente",
            urgency: entry.values["Urgency"] || "Sin resumen",
            priority: entry.values["Priority"] || "Estado desconocido",
            type: "ticket"
          }));
          
          setTickets(ticketsData);
        } else {
          setTickets([]);
        }
        
        // Hacer la petición a la API para obtener las órdenes de trabajo
        const workOrdersResponse = await axios.request({
          url: `${page}/api/arsys/v1/entry/WOI:WorkOrder?q=%27ASGRPID%27%3D%22${groupId}%22%20AND%20%27ASLOGID%27%3D%22${storedUsername}%22%20AND%27Status%27!%3D%22Completed%22%20AND%20%27Status%27!%3D%22Rejected%22%20AND%20%27Status%27!%3D%22Cancelled%22`,
          method: "GET",
          headers: headersList,
        });
        
        console.log("Respuesta API Órdenes de Trabajo:", JSON.stringify(workOrdersResponse.data));
        
        // Extraer las órdenes de trabajo de la respuesta
        if (workOrdersResponse.data && workOrdersResponse.data.entries) {
          const workOrdersData = workOrdersResponse.data.entries.map((entry: any) => ({
            id: entry.values["Request ID"] || "Sin ID",
            dwpSrid: entry.values["DWP_SRID"] || entry.values["SRID"] || "Sin ID de petición",
            workOrderId: entry.values["Work Order ID"] || "Sin número de orden",
            urgency: entry.values["Urgency"] || "Sin urgencia",
            priority: entry.values["Priority"] || "Sin prioridad",
            type: "workOrder"
          }));
          
          setWorkOrders(workOrdersData);
        } else {
          setWorkOrders([]);
        }
      } catch (error) {
        console.error("Error al obtener datos:", error);
        Alert.alert("Error", "No se pudieron obtener los tickets o las órdenes de trabajo");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [groupId]);
  
  const handleBack = () => {
    router.back();
  };

  // Manejar la navegación al detalle del ticket
  const handleTicketPress = (item: any) => {
    router.push({
      pathname: "/detalleTickets",
      params: {
        id: item.id,
        dwpSrid: item.dwpSrid,
        type: item.type,
        incidentNumber: item.type === "ticket" ? item.incidentNumber : item.workOrderId,
        urgency: item.urgency,
        priority: item.priority
      }
    });
  };

  // Renderizar un item de ticket
  const renderTicketItem = ({ item }: { item: any }) => {
    if (item.type === "ticket") {
      return (
        <TouchableOpacity onPress={() => handleTicketPress(item)}>
          <View style={styles.ticketItem}>
            <Text style={styles.ticketTitle}>ID de Petición: {item.dwpSrid}</Text>
            <Text style={styles.ticketSubtitle}>Número de Incidente: {item.incidentNumber}</Text>
            <Text style={styles.ticketSummary}>Urgencia: {item.urgency}</Text>
            <Text style={styles.ticketStatus}>Prioridad: {item.priority}</Text>
          </View>
        </TouchableOpacity>
      );
    } else {
      return (
        <TouchableOpacity onPress={() => handleTicketPress(item)}>
          <View style={[styles.ticketItem, styles.workOrderItem]}>
            <Text style={styles.ticketTitle}>ID de Petición: {item.dwpSrid}</Text>
            <Text style={styles.ticketSubtitle}>Número de Orden: {item.workOrderId}</Text>
            <Text style={styles.ticketSummary}>Urgencia: {item.urgency}</Text>
            <Text style={styles.ticketStatus}>Prioridad: {item.priority}</Text>
          </View>
        </TouchableOpacity>
      );
    }
  };
  
  // Renderizar un encabezado de sección
  const renderSectionHeader = ({ section }: { section: any }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  );

  // Preparar los datos para la SectionList
  const sections = [
    { title: "Incidentes", data: tickets },
    { title: "Órdenes de Trabajo", data: workOrders }
  ].filter(section => section.data.length > 0);
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{groupName}</Text>
      </View>
      
      {loading ? (
        <ActivityIndicator size="large" color="#1976d2" style={styles.loader} />
      ) : sections.length > 0 ? (
        <SectionList
          sections={sections}
          renderItem={renderTicketItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item, index) => `${item.type}-${item.id}-${index}`}
          style={styles.ticketsList}
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
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ticketsList: {
    padding: 16,
  },
  ticketItem: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#1976d2',
  },
  workOrderItem: {
    borderLeftColor: '#4caf50',
  },
  ticketTitle: {
    fontSize: 16,
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
  ticketStatus: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  sectionHeader: {
    backgroundColor: '#e0e0e0',
    padding: 10,
    marginBottom: 8,
    borderRadius: 4,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
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
  }
})