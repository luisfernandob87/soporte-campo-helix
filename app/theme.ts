import { StyleSheet } from "react-native";

/**
 * Guía de estilos de la app.
 *
 * La app venía con 44 colores hex distintos y varios casi duplicados (#333 y
 * #333333, #666 y #666666, tres tonos de borde...). Estos tokens son los mismos
 * tonos que ya se usaban, unificados, para que todas las pantallas se vean
 * igual. Lo que se agrega a una pantalla nueva sale de aquí.
 */
export const COLORES = {
  // Marca
  primario: "#1976d2",
  primarioOscuro: "#0d47a1",
  primarioClaro: "#e3f2fd",
  // Estados
  exito: "#2e7d32",
  alerta: "#ef6c00",
  alertaOscuro: "#e65100",
  alertaFondo: "#fff3e0",
  alertaTexto: "#b45309",
  peligro: "#d32f2f",
  // Superficies
  superficie: "#ffffff",
  superficieApagada: "#f5f5f5",
  deshabilitado: "#f0f0f0",
  borde: "#e0e0e0",
  // Texto
  textoPrimario: "#333333",
  textoSecundario: "#666666",
  textoTerciario: "#999999",
} as const;

export const RADIO = {
  sm: 6,
  md: 8,
  lg: 10,
} as const;

// Alto mínimo de cualquier control que se toca con el dedo. Es el estándar
// táctil y evita que dos botones con textos de distinto largo midan diferente.
export const ALTO_TACTIL = 48;

// Opacidad para el feedback al pulsar. Se aplica como activeOpacity en cada
// TouchableOpacity: una sola propiedad y funciona en iOS y Android.
export const OPACIDAD_PULSADO = 0.7;

export const estilos = StyleSheet.create({
  botonBase: {
    minHeight: ALTO_TACTIL,
    borderRadius: RADIO.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  // Variantes de relleno
  primario: {
    backgroundColor: COLORES.primario,
  },
  alerta: {
    backgroundColor: COLORES.alerta,
  },
  exito: {
    backgroundColor: COLORES.exito,
  },
  peligro: {
    backgroundColor: COLORES.peligro,
  },
  neutro: {
    backgroundColor: COLORES.deshabilitado,
  },
  deshabilitado: {
    opacity: 0.5,
  },

  // Variantes de contorno: para las acciones que no compiten con la principal
  contornoPrimario: {
    backgroundColor: COLORES.superficie,
    borderWidth: 1,
    borderColor: COLORES.primario,
  },
  contornoAlerta: {
    backgroundColor: COLORES.superficie,
    borderWidth: 1,
    borderColor: COLORES.alerta,
  },
  contornoExito: {
    backgroundColor: COLORES.superficie,
    borderWidth: 1,
    borderColor: COLORES.exito,
  },

  // Textos de botón
  textoClaro: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  textoPrimario: {
    color: COLORES.primario,
    fontSize: 16,
    fontWeight: "700",
  },
  textoAlerta: {
    color: COLORES.alerta,
    fontSize: 16,
    fontWeight: "700",
  },
  textoExito: {
    color: COLORES.exito,
    fontSize: 16,
    fontWeight: "700",
  },
  textoOscuro: {
    color: COLORES.textoPrimario,
    fontSize: 16,
    fontWeight: "700",
  },
  textoDeshabilitado: {
    color: COLORES.textoTerciario,
    fontSize: 16,
    fontWeight: "700",
  },

  // Superficies comunes
  tarjeta: {
    backgroundColor: COLORES.superficie,
    borderRadius: RADIO.md,
    borderWidth: 1,
    borderColor: COLORES.borde,
    padding: 14,
  },
});
