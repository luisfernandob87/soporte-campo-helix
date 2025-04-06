import { Button, StyleSheet, Text, View, Alert, FlatList, TouchableOpacity } from 'react-native'
import React, { useState, useEffect } from 'react'
import AsyncStorage from "@react-native-async-storage/async-storage"
import axios from "axios"
import { useRouter } from "expo-router"

const menu = () => {
  const [usuario, setUsuario] = useState("");
  const [fullName, setFullName] = useState("");
  const [supportGroups, setSupportGroups] = useState<{ id: string; name: string; role: string }[]>([]);
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
              // Hacer la petición para obtener los grupos de soporte
              try {
                const supportGroupResponse = await axios.request({
                  url: `${page}/api/arsys/v1.0/entry/CTM:Support Group Association?q=%27Login%20ID%27%3D%22${username}%22`,
                  method: "GET",
                  headers: headersList,
                });
                
                console.log("Respuesta grupos de soporte:", JSON.stringify(supportGroupResponse.data));
                
                // Extraer los grupos de soporte
                if (supportGroupResponse.data && supportGroupResponse.data.entries) {
                  // Primero obtenemos los IDs de los grupos
                  const groupsData = supportGroupResponse.data.entries.map((entry: { values: { [key: string]: string } }) => ({
                    id: entry.values["Support Group ID"],
                    tempName: entry.values["Support Group Name"] || entry.values["Support Group ID"],
                    
                  }));
                  
                  // Ahora hacemos peticiones para obtener el nombre completo de cada grupo
                  const fetchGroupDetails = async () => {
                    const updatedGroups = [];
                    
                    for (const group of groupsData) {
                      try {
                        // Hacer petición para obtener detalles del grupo por su ID
                        const groupDetailResponse = await axios.request({
                          url: `${page}/api/arsys/v1.0/entry/CTM:Support Group?q=%27Support%20Group%20ID%27%3D%22${group.id}%22`,
                          method: "GET",
                          headers: headersList,
                        });
                        
                        console.log(`Respuesta detalle grupo ${group.id}:`, JSON.stringify(groupDetailResponse.data));
                        
                        // Extraer el nombre completo del grupo
                        if (groupDetailResponse.data && 
                            groupDetailResponse.data.entries && 
                            groupDetailResponse.data.entries.length > 0 &&
                            groupDetailResponse.data.entries[0].values["Support Group Name"]) {
                          
                          updatedGroups.push({
                            id: group.id,
                            name: groupDetailResponse.data.entries[0].values["Support Group Name"],
                            role: groupDetailResponse.data.entries[0].values["Support Group Role"] || "Unknown Role",
                          });
                        } else {
                          // Si no se encuentra el nombre, usar el nombre temporal
                          updatedGroups.push({
                            id: group.id,
                            name: group.tempName,
                            role: "Unknown Role",
                          });
                        }
                      } catch (error) {
                        console.error(`Error al obtener detalles del grupo ${group.id}:`, error);
                        // En caso de error, usar el nombre temporal
                        updatedGroups.push({
                          id: group.id,
                          name: group.tempName,
                          role: "Unknown Role",
                        });
                      }
                    }
                    
                    // Actualizar el estado con los grupos completos
                    setSupportGroups(updatedGroups);
                  };
                  
                  fetchGroupDetails();
                }
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
  
  const handleLogout = () => {
    // Limpiar el almacenamiento y redirigir al login
    AsyncStorage.clear();
    router.push("/");
  };

  // Renderizar un item de grupo de soporte
  const renderSupportGroup = ({ item }: { item: { id: string; name: string; role: string; } }) => {
    const handleGroupPress = () => {
      // Navegar a la pantalla de tickets con el ID del grupo y el nombre de usuario
      router.push({
        pathname: "/tickets",
        params: { groupId: item.id, groupName: item.name }
      });
    };
    
    return (
      <TouchableOpacity style={styles.groupItem} onPress={handleGroupPress}>
        <Text style={styles.groupText}>{item.name}</Text>
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
            keyExtractor={(item: { id: string; name: string;}) => item.id}
            style={styles.groupsList}
          />
        </View>
      )}
      
      <Button title="Cerrar Sesion" onPress={handleLogout} />
    </View>
  )
}

export default menu

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
  }
})