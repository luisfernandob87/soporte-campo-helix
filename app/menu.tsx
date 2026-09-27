import { StyleSheet, Text, View, Alert, FlatList, TouchableOpacity } from 'react-native'
import React, { useState, useEffect } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import axios from "axios"
import { useRouter } from "expo-router"
import { startTracking, stopTracking } from "./services/locationService"
import { detenerCanalNotificaciones } from "./services/notificacionesService"
import { obtenerGruposRuta, GrupoRuta } from "./services/gruposSoporte"
import { COLORES, RADIO, OPACIDAD_PULSADO, estilos } from "./theme"

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
      <TouchableOpacity
        style={styles.groupItem}
        onPress={handleGroupPress}
        activeOpacity={OPACIDAD_PULSADO}
      >
        <Text style={styles.groupText}>{item.nombre}</Text>
        <Text style={styles.groupChevron}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.pantalla}>
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
            contentContainerStyle={styles.groupsListContent}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}

      <View style={styles.pie}>
        <TouchableOpacity
          style={[estilos.botonBase, estilos.primario, styles.botonPie]}
          onPress={() => router.push("/crearIncidente")}
          activeOpacity={OPACIDAD_PULSADO}
        >
          <Text style={estilos.textoClaro}>Crear Incidente</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[estilos.botonBase, estilos.peligro, styles.botonPie]}
          onPress={handleLogout}
          activeOpacity={OPACIDAD_PULSADO}
        >
          <Text style={estilos.textoClaro}>Cerrar Sesión</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default Menu

const styles = StyleSheet.create({
  // El menú ya no se centra: la lista de grupos toma el espacio disponible y
  // scrollea, y los botones quedan siempre al fondo. Antes el centrado peleaba
  // con el scroll en cuanto había más de dos grupos.
  pantalla: {
    flex: 1,
    backgroundColor: COLORES.superficieApagada,
    paddingTop: 50,
    paddingHorizontal: 20,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5
  },
  nameText: {
    fontSize: 18,
    marginBottom: 14,
    color: COLORES.primario
  },
  groupsContainer: {
    flex: 1,
    width: '100%',
  },
  groupsTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
    color: COLORES.textoSecundario,
  },
  groupsList: {
    flex: 1,
  },
  groupsListContent: {
    paddingBottom: 12,
  },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORES.superficie,
    borderRadius: RADIO.md,
    borderWidth: 1,
    borderColor: COLORES.borde,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  groupText: {
    flex: 1,
    fontSize: 15,
    color: COLORES.textoPrimario,
  },
  groupChevron: {
    fontSize: 22,
    lineHeight: 24,
    color: COLORES.textoTerciario,
    marginLeft: 12,
  },
  roleText: {
    fontSize: 12,
    color: COLORES.textoSecundario,
    fontStyle: 'italic'
  },
  pie: {
    alignItems: 'center',
    paddingBottom: 28,
    paddingTop: 8,
  },
  botonPie: {
    minWidth: 200,
    marginBottom: 12,
  },
})