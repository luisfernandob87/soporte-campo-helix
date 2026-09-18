export interface PrioridadFormateada {
  label: string;
  color: string;
}

// Traduce la prioridad de BMC ("High", "Medium", "Low", "Critical") al español
// y le asigna un color: alta/crítica en rojo, media en naranja, baja en verde.
export const prioridadFormateada = (priority: string): PrioridadFormateada => {
  const p = (priority || "").toLowerCase();
  if (
    p.includes("high") ||
    p.includes("critical") ||
    p.includes("urgent") ||
    p.includes("alta") ||
    p.includes("critica")
  ) {
    return { label: "Alta", color: "#d32f2f" };
  }
  if (
    p.includes("medium") ||
    p.includes("med") ||
    p.includes("media") ||
    p.includes("moderate")
  ) {
    return { label: "Media", color: "#ef6c00" };
  }
  if (p.includes("low") || p.includes("baja")) {
    return { label: "Baja", color: "#388e3c" };
  }
  return { label: priority || "Sin prioridad", color: "#666666" };
};