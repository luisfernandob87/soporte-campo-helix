import { getBackendUrl } from "./locationService";

export type TicketNotificacion = {
  tipo: string;
  requestId: string;
  dwpSrid: string;
  incidentNumber: string;
  cliente: string;
  prioridad: string;
  grupo: string;
};

export type MensajeNotificacion = {
  notificacion_id?: number;
  mensaje: string;
  fecha: string;
  ticket?: TicketNotificacion | null;
};

type Handler = (m: MensajeNotificacion) => void;

let socket: WebSocket | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;
let usuarioActual: string | null = null;
let handlerActual: Handler | null = null;
let reconectar = false;

const RETARDO_RECONEXION = 5000;

export const registrarHandlerNotificaciones = (handler: Handler | null) => {
  handlerActual = handler;
};

export const iniciarCanalNotificaciones = (usuarioId: string | number) => {
  usuarioActual = String(usuarioId);
  reconectar = true;
  emitirPendientes();
  abrirSocket();
};

export const detenerCanalNotificaciones = () => {
  reconectar = false;
  usuarioActual = null;
  cerrarSocket();
};

const emitir = (mensaje: MensajeNotificacion) => {
  if (handlerActual) {
    handlerActual(mensaje);
  }
};

const datosTicketDesdeFila = (fila: any): TicketNotificacion | null => {
  if (!fila) return null;
  if (fila.datos_ticket && typeof fila.datos_ticket === "string") {
    try {
      const parsed = JSON.parse(fila.datos_ticket);
      if (parsed && parsed.tipo && parsed.requestId) {
        return parsed as TicketNotificacion;
      }
    } catch {
      // datos inválidos: se ignora
    }
  }
  if (fila.ticket && fila.ticket.tipo && fila.ticket.requestId) {
    return fila.ticket as TicketNotificacion;
  }
  return null;
};

const emitirPendientes = async () => {
  if (!usuarioActual) return;
  try {
    const res = await fetch(
      `${getBackendUrl()}/notificaciones/pendientes/${encodeURIComponent(usuarioActual)}`
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.forEach((m) =>
          emitir({
            notificacion_id: m.notificacion_id,
            mensaje: m.mensaje,
            fecha: m.fecha,
            ticket: datosTicketDesdeFila(m),
          })
        );
      }
    }
  } catch {
    // Sin conexión: se reintentará al conectar
  }
};

const abrirSocket = () => {
  cerrarSocket();
  if (!usuarioActual) return;

  const base = getBackendUrl().replace(/^http/, "ws");
  const wsUrl = `${base}/ws?usuario_id=${encodeURIComponent(usuarioActual)}`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    emitirPendientes();
  };

  socket.onmessage = (evento) => {
    try {
      const data = JSON.parse(String(evento.data));
      if (data && data.type === "notificacion") {
        emitir({
          notificacion_id: data.notificacion_id,
          mensaje: data.mensaje,
          fecha: data.fecha,
          ticket: data.ticket ? (data.ticket as TicketNotificacion) : null,
        });
      }
    } catch {
      // Ignorar mensajes no JSON
    }
  };

  socket.onclose = () => {
    socket = null;
    if (reconectar) programarReconexion();
  };

  socket.onerror = () => {
    if (socket) socket.close();
  };
};

const programarReconexion = () => {
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(abrirSocket, RETARDO_RECONEXION);
};

const cerrarSocket = () => {
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
};