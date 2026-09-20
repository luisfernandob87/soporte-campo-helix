import { Stack } from "expo-router";
import { NotificacionesProvider } from "./context/NotificacionesContext";

export default function RootLayout() {
  return (
    <NotificacionesProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animationType: "slide_from_right",
        }}
      />
    </NotificacionesProvider>
  );
}