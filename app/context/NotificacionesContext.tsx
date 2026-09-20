import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { router, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  registrarHandlerNotificaciones,
  type MensajeNotificacion,
  type TicketNotificacion,
} from "../services/notificacionesService";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type NotificacionesContextValue = {
  ultima: MensajeNotificacion | null;
};

const NotificacionesContext = createContext<NotificacionesContextValue>({
  ultima: null,
});

export function NotificacionesProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [ultima, setUltima] = useState<MensajeNotificacion | null>(null);
  const traslacion = useRef(new Animated.Value(-160)).current;
  const ocultarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    configurarNotificaciones();
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        const ticket = data && data.ticket ? (data.ticket as TicketNotificacion) : null;
        if (ticket) {
          irAlTicket(ticket);
        } else {
          try {
            router.push("/notificaciones");
          } catch {
            // Navegador aún no montado
          }
        }
      }
    );

    // Push tocado que abrió la app
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          const data = response.notification.request.content.data;
          const ticket = data && data.ticket ? (data.ticket as TicketNotificacion) : null;
          if (ticket) irAlTicket(ticket);
        }
      })
      .catch(() => null);

    return () => sub.remove();
  }, []);

  const irAlTicket = (t: TicketNotificacion) => {
    try {
      router.push({
        pathname: "/detalleTickets",
        params: {
          id: t.requestId,
          dwpSrid: t.dwpSrid,
          type: t.tipo,
          incidentNumber: t.incidentNumber,
          cliente: t.cliente,
          priority: t.prioridad,
        },
      });
    } catch {
      // El navegador aún no está montado
    }
  };

  const irSegunMensaje = (m: MensajeNotificacion) => {
    if (m && m.ticket) {
      irAlTicket(m.ticket);
    } else {
      try {
        router.push("/notificaciones");
      } catch {
        // El navegador aún no está montado
      }
    }
  };

  useEffect(() => {
    const activo = { valor: true };
    const onMensaje = (m: MensajeNotificacion) => {
      if (activo.valor) mostrar(m);
    };
    registrarHandlerNotificaciones(onMensaje);
    return () => {
      activo.valor = false;
      registrarHandlerNotificaciones(null);
      if (ocultarTimer.current) clearTimeout(ocultarTimer.current);
    };
  }, []);

  const configurarNotificaciones = async () => {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Notificaciones",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
          vibrationPattern: [0, 250, 250, 250],
        });
      }
      await Notifications.requestPermissionsAsync().catch(() => null);
    } catch {
      // Ignorar errores de configuración de notificaciones
    }
  };

  const mostrar = (m: MensajeNotificacion) => {
    setUltima(m);
    Animated.timing(traslacion, { toValue: 0, duration: 250, useNativeDriver: true }).start();

    Notifications.scheduleNotificationAsync({
      content: {
        title: "Soporte Campo VPC",
        body: m.mensaje,
        sound: "default",
        data: { notificacion_id: m.notificacion_id, ticket: m.ticket ?? null },
      },
      trigger: null,
    }).catch(() => null);

    if (ocultarTimer.current) clearTimeout(ocultarTimer.current);
    ocultarTimer.current = setTimeout(() => {
      ocultarBanner();
    }, 6000);
  };

  const ocultarBanner = () => {
    if (ocultarTimer.current) clearTimeout(ocultarTimer.current);
    Animated.timing(traslacion, {
      toValue: -160,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setUltima(null));
  };

  return (
    <NotificacionesContext.Provider value={{ ultima }}>
      {children}
      {ultima && (
        <Animated.View
          style={[
            estilos.banner,
            { paddingTop: insets.top + 6, transform: [{ translateY: traslacion }] },
          ]}
        >
          <TouchableOpacity
            style={estilos.bannerContenido}
            activeOpacity={0.9}
            onPress={() => {
              ocultarBanner();
              irSegunMensaje(ultima);
            }}
          >
            <Text style={estilos.bannerTitulo}>Soporte Campo VPC</Text>
            <Text style={estilos.bannerMensaje} numberOfLines={3}>
              {ultima.mensaje}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}
      <CampanaNotificaciones topOffset={ultima ? 96 : 12} />
    </NotificacionesContext.Provider>
  );
}

export const useNotificaciones = () => useContext(NotificacionesContext);

function CampanaNotificaciones({ topOffset }: { topOffset: number }) {
  const insets = useSafeAreaInsets();
  const ruta = usePathname();

  // No mostrar en la pantalla de notificaciones ni en el login
  if (ruta === "/notificaciones" || ruta === "/") return null;

  return (
    <TouchableOpacity
      style={[estilos.campana, { top: insets.top + topOffset }]}
      activeOpacity={0.8}
      hitSlop={8}
      onPress={() => {
        try {
          router.push("/notificaciones");
        } catch {
          // El navegador aún no está montado
        }
      }}
    >
      <Ionicons name="notifications" size={24} color="#1976d2" />
    </TouchableOpacity>
  );
}

const estilos = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    elevation: 10,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  bannerContenido: {
    backgroundColor: "#1976d2",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
  },
  bannerTitulo: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 2,
  },
  bannerMensaje: {
    color: "#f0f6ff",
    fontSize: 13,
    lineHeight: 18,
  },
  campana: {
    position: "absolute",
    right: 16,
    zIndex: 990,
    elevation: 9,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});