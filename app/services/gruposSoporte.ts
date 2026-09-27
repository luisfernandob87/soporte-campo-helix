import axios from "axios";

const PAGE = "https://servicedesk-dev-is.onbmc.com";

export type GrupoRuta = {
  id: string;
  nombre: string;
};

/**
 * Grupos de soporte "Ruta" asociados al técnico que está en la app.
 *
 * Vive aquí porque lo necesitan dos pantallas: el menú y el alta de incidentes.
 * La asociación no trae el nombre del grupo (viene null), así que se consulta
 * cada uno en CTM:Support Group y se filtran los que empiezan con "Ruta".
 */
export const obtenerGruposRuta = async (
  token: string,
  login: string
): Promise<GrupoRuta[]> => {
  const headersList = {
    Accept: "*/*",
    Authorization: `AR-JWT ${token}`,
  };

  const asociacion = await axios.request({
    url: `${PAGE}/api/arsys/v1.0/entry/CTM:Support Group Association?q=%27Login%20ID%27%3D%22${login}%22`,
    method: "GET",
    headers: headersList,
  });

  const entradas = asociacion.data?.entries;
  if (!Array.isArray(entradas) || entradas.length === 0) return [];

  const ids: string[] = [];
  for (const entry of entradas) {
    const id = entry.values?.["Support Group ID"];
    if (id) ids.push(id);
  }

  const grupos: GrupoRuta[] = [];
  for (const id of ids) {
    let nombre = "";
    try {
      const detalle = await axios.request({
        url: `${PAGE}/api/arsys/v1.0/entry/CTM:Support Group?q=%27Support%20Group%20ID%27%3D%22${id}%22`,
        method: "GET",
        headers: headersList,
      });
      nombre = detalle.data?.entries?.[0]?.values?.["Support Group Name"] || "";
    } catch (error) {
      console.error(`Error al obtener el grupo ${id}:`, error);
    }
    if (nombre.startsWith("Ruta")) {
      grupos.push({ id, nombre });
    }
  }

  return grupos;
};
