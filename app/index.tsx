import { View, Text, Button, Alert, TextInput, ActivityIndicator, StyleSheet, Image } from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import logo from "../assets/images/VPC_LOGO_texto_vertical.png";

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
    const [usuario, setUsuario] = useState("");
    const [password, setPassword] = useState("");
    const data = {
      username: usuario,
      password: password,
    };
   
    AsyncStorage.clear();
   
    const page = "https://servicedesk-dev-is.onbmc.com";
   
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
            } catch (error) {
  
            }
            
            router.push("/menu"); 
          }
        )
          .catch(function (error) {
            console.log(error);
            Alert.alert("Contraseña o usuario incorrecto comuniquese con el Administrador");
          });
      }
      setLoading(false);
      setPassword("");
  
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
          <View style={{ backgroundColor: "#1976d2", borderRadius: 5 }}>
            <Button 
              title="Acceder" 
              color="#ffffff" 
              onPress={submit} 
            />
          </View>
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
});
