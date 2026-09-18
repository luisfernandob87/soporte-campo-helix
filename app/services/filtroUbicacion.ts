// Utilidades de posicionamiento: distancia haversine (metros) y filtro Kalman 2D
// (posición + velocidad por eje) para suavizar la señal GPS.
//
// Unidades: los grados se convierten a un marco métrico local centrado en una
// referencia, el filtro trabaja en metros y el resultado se devuelve a grados.

const RAD_DEG = Math.PI / 180;
const METROS_POR_GRADO_LAT = 111320;
const RADIO_TIERRA_M = 6371000;

// Varianza del ruido de proceso (aceleración inesperada, m²/s⁴). Un valor bajo
// filtra más el jitter pero hace que el filtro "reaccione" más lento.
const RUIDO_PROCESO_ACEL = 3;
// Si la posición filtrada se aleja más de este radio de la referencia, se
// recentra el marco métrico para evitar errores de escala por latitud.
const UMBRAL_RECENTRAR_M = 500;

export interface PuntoFiltrado {
  latitude: number;
  longitude: number;
}

const gradoLonEscala = (lat: number): number =>
  METROS_POR_GRADO_LAT * Math.cos(lat * RAD_DEG);

export const distanciaMetros = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = (lat2 - lat1) * RAD_DEG;
  const dLon = (lon2 - lon1) * RAD_DEG;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * RAD_DEG) *
      Math.cos(lat2 * RAD_DEG) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(a));
};

// Kalman 1D (un eje): estado [posición, velocidad], ruido de medición derivado
// de la precisión real del punto (accuracy²).
class FiltroKalman1D {
  private pos = 0;
  private vel = 0;
  private p11 = 1000;
  private p12 = 0;
  private p21 = 0;
  private p22 = 1000;
  private ultimoTs: number | null = null;

  actualizar(medicion: number, ts: number, ruidoMedicion: number): number {
    const dt =
      this.ultimoTs === null
        ? 1
        : Math.max((ts - this.ultimoTs) / 1000, 0.001);
    this.ultimoTs = ts;

    // Predicción: x' = F x, P' = F P Fᵀ + Q
    const dt2 = dt * dt;
    this.pos += this.vel * dt;
    const q11 = RUIDO_PROCESO_ACEL * (dt2 * dt2) / 4;
    const q12 = RUIDO_PROCESO_ACEL * (dt2 * dt) / 2;
    const q22 = RUIDO_PROCESO_ACEL * dt2;

    const p11 = this.p11 + dt * (this.p12 + this.p21) + dt2 * this.p22 + q11;
    const p12 = this.p12 + dt * this.p22 + q12;
    const p21 = this.p21 + dt * this.p22 + q12;
    const p22 = this.p22 + q22;

    // Corrección con la medición
    const r = ruidoMedicion * ruidoMedicion;
    const s = p11 + r;
    const k1 = p11 / s;
    const k2 = p21 / s;

    const innovacion = medicion - this.pos;
    this.pos += k1 * innovacion;
    this.vel += k2 * innovacion;

    // Covarianza (forma de Joseph para estabilidad numérica): P' = (I-KH)P(I-KH)ᵀ + KRKᵀ
    const a11 = 1 - k1;
    const m11 = a11 * p11;
    const m12 = a11 * p12;
    const m21 = p21 - k2 * p11;
    const m22 = p22 - k2 * p12;

    this.p11 = a11 * m11 + k1 * k1 * r;
    this.p12 = (m12 - k2 * m11) + k1 * k2 * r;
    this.p21 = a11 * m21 + k1 * k2 * r;
    this.p22 = (-k2 * m21 + m22) + k2 * k2 * r;

    return this.pos;
  }
}

export class FiltroKalman {
  private refLat: number | null = null;
  private refLon: number | null = null;
  private fx = new FiltroKalman1D();
  private fy = new FiltroKalman1D();

  filtrar(
    lat: number,
    lon: number,
    accuracy: number,
    ts: number
  ): PuntoFiltrado {
    if (this.refLat === null || this.refLon === null) {
      this.refLat = lat;
      this.refLon = lon;
    }
    const refLat = this.refLat;
    const refLon = this.refLon;
    const escala = gradoLonEscala(refLat);

    // Convertir a metros en el marco local
    const x = (lon - refLon) * escala;
    const y = (lat - refLat) * METROS_POR_GRADO_LAT;

    const fxFiltrado = this.fx.actualizar(x, ts, accuracy);
    const fyFiltrado = this.fy.actualizar(y, ts, accuracy);

    const latFiltrada = refLat + fyFiltrado / METROS_POR_GRADO_LAT;
    const lonFiltrada = refLon + fxFiltrado / escala;

    // Recentrar si la medición quedó lejos de la referencia
    if (distanciaMetros(lat, lon, refLat, refLon) > UMBRAL_RECENTRAR_M) {
      this.refLat = latFiltrada;
      this.refLon = lonFiltrada;
      this.fx = new FiltroKalman1D();
      this.fy = new FiltroKalman1D();
      // Sembrar la posición filtrada actual como origen
      this.fx.actualizar(0, ts, accuracy);
      this.fy.actualizar(0, ts, accuracy);
    }

    return { latitude: latFiltrada, longitude: lonFiltrada };
  }
}