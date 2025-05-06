import { View, Text, Alert, TextInput, ActivityIndicator, StyleSheet, Image, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import logo from "../assets/images/VPC_LOGO_texto_vertical.png";
import * as Location from 'expo-location';

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
    const [usuario, setUsuario] = useState("");
    const [password, setPassword] = useState("");
    const data = {
      username: usuario,
      password: password,
    };
   
    // No limpiamos AsyncStorage aquí para mantener las credenciales
   
    const page = "https://servicedesk-dev-is.onbmc.com";
   
    // Función para actualizar la ubicación del usuario en el backend
    const actualizarUbicacionUsuario = async (usuarioId) => {
      try {
        console.log("Iniciando actualización de ubicación para usuario ID:", usuarioId);
        
        if (!usuarioId) {
          console.error("Error: ID de usuario no válido", usuarioId);
          setLoading(false);
          setPassword("");
          router.push("/menu");
          return;
        }
        
        // Solicitar permisos de ubicación
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log('Permiso de ubicación denegado');
          setLoading(false);
          setPassword("");
          router.push("/menu");
          return;
        }
        
        
        // Asegurar que el ID del usuario tenga el formato correcto
        const idUsuarioFormateado = String(usuarioId).trim();
        console.log("ID de usuario formateado:", idUsuarioFormateado);
        let location;
        
        // Obtener la ubicación actual
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High
        });
        
        console.log("Ubicación obtenida:", {
          latitud: location.coords.latitude,
          longitud: location.coords.longitude
        });
        
        // Actualizar la ubicación en el backend
        const updateUrl = `https://backend-soporte-campo-vpc.onrender.com/usuario/${idUsuarioFormateado}`;
        console.log("URL de actualización:", updateUrl);
        
        const response = await axios.put(updateUrl, {
          latitud: location.coords.latitude,
          longitud: location.coords.longitude
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        console.log("Respuesta de actualización:", response.data);
        console.log("Ubicación actualizada exitosamente");
      } catch (error) {
        console.error("Error al actualizar ubicación:", error);
        if (error.response) {
          console.error("Datos de respuesta de error:", error.response.data);
          console.error("Estado de respuesta de error:", error.response.status);
          console.error("Encabezados de respuesta:", error.response.headers);
        } else if (error.request) {
          // La solicitud fue hecha pero no se recibió respuesta
          console.error("Error en la solicitud sin respuesta:", error.request);
        } else {
          // Algo sucedió en la configuración de la solicitud que desencadenó un error
          console.error("Error en la configuración de la solicitud:", error.message);
        }
        
        // Intentar nuevamente con un formato de URL diferente como alternativa
        try {
          console.log("Intentando actualizar ubicación con formato alternativo...");
          // Probar con otro endpoint
          const alternativeUrl = `https://backend-soporte-campo-vpc.onrender.com/usuario/ubicacion/${idUsuarioFormateado}`;
          console.log("URL alternativa 1:", alternativeUrl);
          
          const altResponse = await axios.post(alternativeUrl, {
            latitud: location.coords.latitude,
            longitud: location.coords.longitude
          }, {
            headers: {
              'Content-Type': 'application/json'
            }
          });
          
          console.log("Respuesta de actualización alternativa 1:", altResponse.data);
          console.log("Ubicación actualizada exitosamente con método alternativo 1");
          return; // Si funciona, salimos del catch
        } catch (altError) {
          console.error("Error en el primer intento alternativo:", altError);
          
          // Intentar con un segundo formato alternativo
          try {
            const alternativeUrl2 = `https://backend-soporte-campo-vpc.onrender.com/usuarios/${idUsuarioFormateado}/ubicacion`;
            console.log("URL alternativa 2:", alternativeUrl2);
            
            const altResponse2 = await axios.put(alternativeUrl2, {
              latitud: location.coords.latitude,
              longitud: location.coords.longitude
            }, {
              headers: {
                'Content-Type': 'application/json'
              }
            });
            
            console.log("Respuesta de actualización alternativa 2:", altResponse2.data);
            console.log("Ubicación actualizada exitosamente con método alternativo 2");
          } catch (altError2) {
            console.error("Error también en el segundo intento alternativo:", altError2);
            
            // Intentar con un tercer formato alternativo
            try {
              const alternativeUrl3 = `https://backend-soporte-campo-vpc.onrender.com/usuario/actualizarUbicacion`;
              console.log("URL alternativa 3:", alternativeUrl3);
              
              const altResponse3 = await axios.post(alternativeUrl3, {
                id: idUsuarioFormateado,
                usuario: usuario,
                ubicacion: {
                  latitud: location.coords.latitude,
                  longitud: location.coords.longitude
                }
              }, {
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              
              console.log("Respuesta de actualización alternativa 3:", altResponse3.data);
              console.log("Ubicación actualizada exitosamente con método alternativo 3");
            } catch (altError3) {
              console.error("Error también en el tercer intento alternativo:", altError3);
              Alert.alert("Error", "No se pudo actualizar la ubicación. Por favor, intente nuevamente más tarde.");
            }
          }
        }
      } finally {
        // Finalizar el proceso de login
        setLoading(false);
        setPassword("");
        router.push("/menu");
      }
    };
    
    const submit = () => {
      
      if (usuario == "" || password == "") {
        Alert.alert("Ingrese usuario y contraseña");
      } else {
        setLoading(true);
        axios
          .post(
            `${page}/api/jwt/login`,
            data,  {headers: {
              'Accept': '*/*',
              'X-Requested-By': 'XMLHttpRequest',
              'content-type': 'application/x-www-form-urlencoded'
            }}
          )
          .then((res) => {
            const usr = ["username", usuario];
            const tkn = ["token", res.data];
            try {
              AsyncStorage.multiSet([usr, tkn]);
              
              // Obtener datos del usuario desde BMC
              const headersList = {
                "Accept": "*/*",
                "Authorization": `AR-JWT ${res.data}`
              };
              
              // Hacer la petición a la API para obtener los datos del usuario
              axios.request({
                url: `${page}/api/arsys/v1.0/entry/CTM:People?fields=values(Person%20ID%2C%20Remedy%20Login%20ID%2C%20Profile%20Status%2C%20Full%20Name%2C%20Corporate%20E-Mail%2C%20Assignment%20Availability)&q=%27Remedy%20Login%20ID%27%3D%20%22${usuario}%22`,
                method: "GET",
                headers: headersList,
              }).then((userResponse) => {
                // Extraer el nombre completo de la respuesta
                if (userResponse.data && userResponse.data.entries && userResponse.data.entries.length > 0) {
                  const userData = userResponse.data.entries[0].values;
                  const fullName = userData["Full Name"] || "";
                  
                  // Verificar si el usuario existe en el backend
                  axios.get("https://backend-soporte-campo-vpc.onrender.com/usuarios")
                    .then((backendUsers) => {
                      console.log("Respuesta de usuarios del backend:", backendUsers.data);
                      
                      // Verificar que la respuesta tenga el formato esperado
                      if (!Array.isArray(backendUsers.data)) {
                        console.error("Error: La respuesta del backend no es un array", backendUsers.data);
                        setLoading(false);
                        setPassword("");
                        router.push("/menu");
                        return;
                      }
                      // Buscar si el usuario ya existe
                      const userExists = backendUsers.data.some((user) => user.usuario === usuario);
                      console.log("¿Usuario existe en el backend?", userExists);
                      
                      if (!userExists) {
                        // Crear el usuario en el backend
                        axios.post("https://backend-soporte-campo-vpc.onrender.com/usuario", {
                          usuario: usuario,
                          nombreCompleto: fullName
                        })
                        .then((response) => {
                          console.log("Usuario creado exitosamente", response.data);
                          // Verificar y extraer el ID del usuario
                          const userId = response.data.usuario_id || response.data.id || response.data._id;
                          console.log("ID del usuario creado:", userId);
                          
                          if (!userId) {
                            console.error("Error: No se pudo obtener el ID del usuario creado", response.data);
                            setLoading(false);
                            setPassword("");
                            router.push("/menu");
                            return;
                          }
                          
                          // Actualizar ubicación del usuario
                          actualizarUbicacionUsuario(userId);
                        })
                        .catch((error) => {
                          console.error("Error al crear usuario:", error);
                          if (error.response) {
                            console.error("Datos de respuesta de error:", error.response.data);
                          }
                          setLoading(false);
                          setPassword("");
                          router.push("/menu");
                        });
                      } else {
                        console.log("Usuario ya existe en el sistema");
                        // Buscar el ID del usuario existente
                        const existingUser = backendUsers.data.find((user) => user.usuario === usuario);
                        console.log("Usuario existente encontrado:", existingUser);
                        
                        if (existingUser) {
                          // Buscar el ID en diferentes propiedades posibles
                          const userId = existingUser.usuario_id || existingUser.id || existingUser._id;
                          console.log("ID del usuario existente:", userId);
                          
                          if (userId) {
                            // Actualizar ubicación del usuario existente
                            actualizarUbicacionUsuario(userId);
                          } else {
                            console.error("Error: Usuario existente no tiene ID válido", existingUser);
                            setLoading(false);
                            setPassword("");
                            router.push("/menu");
                          }
                        } else {
                          console.error("Error: No se pudo encontrar el usuario en la respuesta del backend");
                          setLoading(false);
                          setPassword("");
                          router.push("/menu");
                        }
                      }
                    })
                    .catch((error) => {
                      console.error("Error al verificar usuarios:", error);
                      setLoading(false);
                      setPassword("");
                      router.push("/menu");
                    });
                } else {
                  console.error("No se encontraron datos del usuario en BMC");
                  setLoading(false);
                  setPassword("");
                  router.push("/menu");
                }
              }).catch((error) => {
                console.error("Error al obtener datos del usuario desde BMC:", error);
                setLoading(false);
                setPassword("");
                router.push("/menu");
              });
            } catch (error) {
              console.error("Error al guardar datos de sesión:", error);
              setLoading(false);
              setPassword("");
              router.push("/menu");
            }
          }
        )
          .catch(function (error) {
            console.log(error);
            Alert.alert("Contraseña o usuario incorrecto comuniquese con el Administrador");
            setLoading(false);
            setPassword("");
          });
      }
    };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 10}}>
            <Image source={logo} 
            style={{ width: 150, height: 150 }}
            resizeMode="contain"
            />
       <TextInput
              style={styles.inputs}
              value={usuario}
              placeholder="Usuario"
              onChangeText={setUsuario}
            />
            <TextInput
              style={styles.inputs}
              value={password}
              secureTextEntry={true}
              placeholder="Contraseña"
              onChangeText={setPassword}
            />
          <TouchableOpacity 
            style={styles.button}
            onPress={submit}
          >
            <Text style={styles.buttonText}>Acceder</Text>
          </TouchableOpacity>
             <ActivityIndicator
                    animating={loading}
                    size="large"
                    color="#1976d2"
                    style={{ marginTop: 30 }}
                  />

    </View>
  );
}
const styles = StyleSheet.create({
  inputs: {
    backgroundColor: "white",
    padding: 10,
    borderRadius: 10,
    width: 200,
  },
  button: {
    backgroundColor: "#1976d2",
    borderRadius: 5,
    padding: 10,
    paddingHorizontal: 20,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "bold",
    textAlign: "center",
  }
});
