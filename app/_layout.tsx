import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NotificacionesProvider } from "./context/NotificacionesContext";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NotificacionesProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            animationType: "slide_from_right",
          }}
        />
      </NotificacionesProvider>
    </GestureHandlerRootView>
  );
}