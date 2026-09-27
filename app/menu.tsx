import { StyleSheet, Text, View, Alert, FlatList, TouchableOpacity } from 'react-native'
import React, { useState, useEffect } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import axios from "axios"
import { useRouter } from "expo-router"
import { startTracking, stopTracking } from "./services/locationService"
import { detenerCanalNotificaciones } from "./services/notificacionesService"
import { obtenerGruposRuta, GrupoRuta } from "./services/gruposSoporte"

const Menu = () => {
  const [usuario, setUsuario] = useState("");
  const [fullName, setFullName] = useState("");
  const [supportGroups, setSupportGroups] = useState<GrupoRuta[]>([]);
  const page = "https://servicedesk-dev-is.onbmc.com";
  const router = useRouter();

  useEffect(() => {
    const getUserData = async () => {
      try {
        // Obtener el nombre de usuario y token almacenados
        const username = await AsyncStorage.getItem("username");
        const token = await AsyncStorage.getItem("token");
        
        if (username && token) {
          setUsuario(username);
          
          // Configurar los headers para la petición
          const headersList = {
            "Accept": "*/*",
            "Authorization": `AR-JWT ${token}`
          };
          
          // Hacer la petición a la API para obtener los datos del usuario
          const response = await axios.request({
            url: `${page}/api/arsys/v1.0/entry/CTM:People?fields=values(Person%20ID%2C%20Remedy%20Login%20ID%2C%20Profile%20Status%2C%20Full%20Name%2C%20Corporate%20E-Mail%2C%20Assignment%20Availability)&q=%27Remedy%20Login%20ID%27%3D%20%22${username}%22`,
            method: "GET",
            headers: headersList,
          });
          
          console.log("URL de la petición:", `${page}/api/arsys/v1.0/entry/CTM:People?fields=values(Person%20ID%2C%20Remedy%20Login%20ID%2C%20Profile%20Status%2C%20Full%20Name%2C%20Corporate%20E-Mail%2C%20Assignment%20Availability)&q=%27Remedy%20Login%20ID%27%3D%20%22${username}%22`);
          
          console.log("Respuesta API:", JSON.stringify(response.data));
          
          // Extraer el nombre completo de la respuesta
          if (response.data && response.data.entries && response.data.entries.length > 0) {
            const userData = response.data.entries[0].values;
            if (userData["Full Name"]) {
              setFullName(userData["Full Name"]);
            }            
            // Los grupos Ruta del técnico se resuelven en el helper compartido,
            // que también usa la pantalla de alta de incidentes.
            try {
              const grupos = await obtenerGruposRuta(token, username);
              setSupportGroups(grupos);
            } catch (error) {
              console.error("Error al obtener grupos de soporte:", error);
            }
          }
        }
      } catch (error) {
        console.error("Error al obtener datos del usuario:", error);
        Alert.alert("Error", "No se pudieron obtener los datos del usuario");
      }
    };
    
    getUserData();
  }, []);
  
  // Iniciar el tracking de ubicación en tiempo real al entrar al menú
  useEffect(() => {
    const iniciarTracking = async () => {
      try {
        const usuarioId = await AsyncStorage.getItem("usuario_id");
        if (usuarioId) {
          await startTracking(usuarioId);
        }
      } catch (error) {
        console.error("Error al iniciar tracking de ubicación:", error);
      }
    };
    
    iniciarTracking();
    
    // Detener el tracking al desmontar la pantalla. Se envuelve en un bloque
    // porque el cleanup del useEffect no puede devolver una promesa.
    return () => {
      stopTracking();
    };
  }, []);
  
  const handleLogout = () => {
    // Detener el tracking de ubicación antes de cerrar sesión
    stopTracking();
    // Detener el canal de notificaciones en tiempo real
    detenerCanalNotificaciones();
    // Limpiar el almacenamiento y redirigir al login
    AsyncStorage.clear();
    router.push("/");
  };

  // Renderizar un item de grupo de soporte
  const renderSupportGroup = ({ item }: { item: GrupoRuta }) => {
    const handleGroupPress = () => {
      // Navegar a la pantalla de tickets con el ID del grupo y el nombre de usuario
      router.push({
        pathname: "/tickets",
        params: { groupId: item.id, groupName: item.nombre }
      });
    };
    
    return (
      <TouchableOpacity style={styles.groupItem} onPress={handleGroupPress}>
        <Text style={styles.groupText}>{item.nombre}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={styles.welcomeText}>Bienvenid@ 👋</Text>
      <Text style={styles.nameText}>{fullName || usuario}</Text>

      {supportGroups.length > 0 && (
        <View style={styles.groupsContainer}>
          <Text style={styles.groupsTitle}>Grupos de Soporte:</Text>
          <FlatList
            data={supportGroups}
            renderItem={renderSupportGroup}
            keyExtractor={(item: GrupoRuta) => item.id}
            style={styles.groupsList}
          />
        </View>
      )}

      <TouchableOpacity
        style={styles.botonAzul}
        onPress={() => router.push("/crearIncidente")}
      >
        <Text style={styles.botonAzulTexto}>Crear Incidente</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.botonAzul, styles.cerrarSesion]}
        onPress={handleLogout}
      >
        <Text style={styles.botonAzulTexto}>Cerrar Sesión</Text>
      </TouchableOpacity>
    </View>
  )
}

export default Menu

const styles = StyleSheet.create({
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5
  },
  nameText: {
    fontSize: 18,
    marginBottom: 10,
    color: '#1976d2'
  },
  groupsContainer: {
    width: '80%',
    marginBottom: 20,
    alignItems: 'center'
  },
  groupsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  groupsList: {
    width: '100%',
    maxHeight: '100%',
  },
  groupItem: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
    marginBottom: 20,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  groupText: {
    fontSize: 14,
    color: '#333'
  },
  roleText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic'
  },
  // Mismo estilo para los dos botones del pie. El de cerrar sesión va en rojo
  // para que no se confunda con una acción más del flujo de trabajo.
  botonAzul: {
    backgroundColor: '#1976d2',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 22,
    marginBottom: 12,
    alignSelf: 'center',
  },
  cerrarSesion: {
    backgroundColor: '#d32f2f',
  },
  botonAzulTexto: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  }
})