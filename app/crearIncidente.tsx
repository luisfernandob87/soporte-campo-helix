import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  ScrollView,
} from "react-native";
import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { useRouter } from "expo-router";
import { obtenerGruposRuta, GrupoRuta } from "./services/gruposSoporte";

const PAGE = "https://servicedesk-dev-is.onbmc.com";
const TIMEOUT_MS = 30000;

// Mínimo de letras para buscar: con menos el API devuelve el formulario
// completo de personas y la lista se vuelve inusable.
const MIN_BUSQUEDA = 3;
const MAX_RESULTADOS = 25;

// El formulario de alta no acepta el incidente si no van estos tres campos:
// los usa para resolver la compañía y el grupo asignado.
const EMPRESA = "Inversiones Centroamericanas, S.A.";
const ORGANIZACION = "VPC";

type Prioridad = "Alta" | "Media" | "Baja";

// La prioridad no es un dato suelto: en Remedy es el resultado de la matriz
// Urgencia x Impacto, así que se envían los tres campos con combinaciones que ya
// existen en el sistema.
const PRIORIDADES: Record<Prioridad, { priority: string; urgency: string; impact: string }> = {
  Alta: { priority: "High", urgency: "2-High", impact: "3-Moderate/Limited" },
  Media: { priority: "Medium", urgency: "3-Medium", impact: "3-Moderate/Limited" },
  Baja: { priority: "Low", urgency: "4-Low", impact: "3-Moderate/Limited" },
};

type Persona = {
  nombre: string;
  login: string;
  personId: string;
  correo: string;
};

// El nombre viene completo ("Juan Luis Aceituno Juarez"). Se parte en la
// última palabra para el apellido porque el detalle es lo de menos peso: la
// persona queda identificada por su login y su Person ID.
const partirNombre = (nombreCompleto: string) => {
  const partes = String(nombreCompleto || "").trim().split(/\s+/);
  if (partes.length <= 1) {
    return { first: partes[0] || "", last: "" };
  }
  return {
    first: partes.slice(0, partes.length - 1).join(" "),
    last: partes[partes.length - 1],
  };
};

type OpcionDesplegable = {
  valor: string;
  texto: string;
  detalle?: string;
};

/**
 * Desplegable propio: el proyecto no trae @react-native-picker/picker, así que
 * se hace con un botón que abre un modal con la lista.
 */
const Desplegable = ({
  etiqueta,
  placeholder,
  valor,
  textoSeleccionado,
  opciones,
  onChange,
  deshabilitado,
}: {
  etiqueta: string;
  placeholder: string;
  valor: string | null;
  textoSeleccionado?: string;
  opciones: OpcionDesplegable[];
  onChange: (valor: string) => void;
  deshabilitado?: boolean;
}) => {
  const [abierto, setAbierto] = useState(false);

  return (
    <View style={styles.grupo}>
      <Text style={styles.etiqueta}>{etiqueta}</Text>
      <TouchableOpacity
        style={[styles.cajaDesplegable, deshabilitado && styles.capaDeshabilitada]}
        onPress={() => setAbierto(true)}
        disabled={deshabilitado}
      >
        <Text style={valor ? styles.desplegableTexto : styles.desplegableVacio}>
          {valor ? textoSeleccionado || placeholder : placeholder}
        </Text>
        <Text style={styles.desplegableFlecha}>▾</Text>
      </TouchableOpacity>

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <View style={styles.modalFondo}>
          <View style={styles.modalCaja}>
            <Text style={styles.modalTitulo}>{etiqueta}</Text>
            <FlatList
              data={opciones}
              keyExtractor={(o) => o.valor}
              renderItem={({ item }) => {
                const marcado = item.valor === valor;
                return (
                  <TouchableOpacity
                    style={[styles.modalOpcion, marcado && styles.modalOpcionSel]}
                    onPress={() => {
                      onChange(item.valor);
                      setAbierto(false);
                    }}
                  >
                    <View style={[styles.radio, marcado && styles.radioSel]}>
                      {marcado ? <View style={styles.radioPunto} /> : null}
                    </View>
                    <View style={styles.modalTexto}>
                      <Text style={[styles.modalOpcionTexto, marcado && styles.modalOpcionTextoSel]}>
                        {item.texto}
                      </Text>
                      {item.detalle ? <Text style={styles.modalDetalle}>{item.detalle}</Text> : null}
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={styles.modalVacio}>No hay opciones</Text>}
            />
            <TouchableOpacity style={styles.modalCerrar} onPress={() => setAbierto(false)}>
              <Text style={styles.modalCerrarTexto}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const CrearIncidente = () => {
  const router = useRouter();

  const [descripcion, setDescripcion] = useState("");
  const [prioridad, setPrioridad] = useState<Prioridad>("Media");
  const [grupos, setGrupos] = useState<GrupoRuta[]>([]);
  const [grupoId, setGrupoId] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Persona[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [solicitante, setSolicitante] = useState<Persona | null>(null);

  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    const cargar = async () => {
      try {
        const [token, username] = await Promise.all([
          AsyncStorage.getItem("token"),
          AsyncStorage.getItem("username"),
        ]);
        if (!token || !username) {
          Alert.alert("Error", "No se encontró información de sesión");
          router.back();
          return;
        }
        const lista = await obtenerGruposRuta(token, username);
        setGrupos(lista);
        if (lista.length === 0) {
          Alert.alert(
            "Sin grupos",
            "No tienes grupos de soporte Ruta asociados, así que no se puede crear el incidente."
          );
        }
      } catch (error) {
        console.error("Error al cargar los grupos:", error);
        Alert.alert("Error", "No se pudieron cargar los grupos de soporte");
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, [router]);

  // Búsqueda del solicitante dentro de CTM:People. El API la resuelve por
  // subcadena aunque se le pase un patrón, por eso se limita lo que se muestra.
  useEffect(() => {
    const termino = busqueda.trim();
    if (termino.length < MIN_BUSQUEDA) {
      setResultados([]);
      return;
    }
    let vigente = true;
    const temporizador = setTimeout(async () => {
      setBuscando(true);
      try {
        const token = await AsyncStorage.getItem("token");
        if (!token) return;
        const response = await axios.request({
          url: `${PAGE}/api/arsys/v1.0/entry/CTM:People?q=${encodeURIComponent(
            `'Full Name' LIKE "%${termino}%"`
          )}`,
          method: "GET",
          headers: { Accept: "*/*", Authorization: `AR-JWT ${token}` },
          timeout: TIMEOUT_MS,
        });
        if (!vigente) return;
        const personas: Persona[] = [];
        for (const entry of response.data?.entries || []) {
          const v = entry.values || {};
          const nombre = v["Full Name"];
          if (!nombre) continue;
          personas.push({
            nombre,
            login: v["Remedy Login ID"] || "",
            personId: v["Person ID"] || "",
            correo: v["Corporate E-mail"] || v["E-mail Address"] || "",
          });
        }
        setResultados(personas.slice(0, MAX_RESULTADOS));
      } catch (error) {
        console.error("Error al buscar solicitantes:", error);
        if (vigente) setResultados([]);
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 400);
    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [busqueda]);

  const grupoElegido = grupos.find((g) => g.id === grupoId) || null;
  const listoParaCrear =
    descripcion.trim() !== "" && grupoId !== null && solicitante !== null && grupos.length > 0;

  const elegirSolicitante = (persona: Persona) => {
    setSolicitante(persona);
    setBusqueda(persona.nombre);
    setResultados([]);
  };

  const crear = async () => {
    if (descripcion.trim() === "") {
      Alert.alert("Falta la descripción", "Describe el problema antes de crear el incidente.");
      return;
    }
    if (!grupoElegido) {
      Alert.alert("Falta el grupo", "Elige el grupo al que va el incidente.");
      return;
    }
    if (!solicitante) {
      Alert.alert("Falta el solicitante", "Busca y selecciona quién solicita el incidente.");
      return;
    }

    setCreando(true);
    try {
      const [token, username] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("username"),
      ]);
      if (!token || !username) {
        Alert.alert("Error", "No se encontró información de sesión");
        return;
      }

      const { first, last } = partirNombre(solicitante.nombre);
      const prioridadValores = PRIORIDADES[prioridad];
      const descripcionLimpia = descripcion.trim();
      const headersList = {
        Accept: "*/*",
        Authorization: `AR-JWT ${token}`,
        "Content-Type": "application/json",
      };

      // 1) Alta en el formulario de creación. El payload es el que acepta
      // Remedy: NO se manda "Short Description" ni "Priority" (la prioridad la
      // calcula la matriz Urgencia x Impact) y sí van los tres campos de
      // compañía, que el formulario exige para resolver el grupo.
      const values: Record<string, string> = {
        Description: descripcionLimpia,
        Urgency: prioridadValores.urgency,
        Impact: prioridadValores.impact,
        Company: EMPRESA,
        "Assigned Support Company": EMPRESA,
        "Assigned Support Organization": ORGANIZACION,
        "Assigned Group ID": grupoElegido.id,
        "Assigned Group": grupoElegido.nombre,
        Status: "In Progress",
        "Reported Source": "Direct Input",
        // Solicitante del caso.
        First_Name: first,
        Last_Name: last,
        Service_Type: "User Service Restoration",
      };
      if (solicitante.login) values["Login_ID"] = solicitante.login;
      if (solicitante.personId) values["Person ID"] = solicitante.personId;
      if (solicitante.correo) values["Internet E-mail"] = solicitante.correo;

      const response = await axios.request({
        url: `${PAGE}/api/arsys/v1.0/entry/HPD:IncidentInterface_Create`,
        method: "POST",
        headers: headersList,
        data: JSON.stringify({ values }),
        timeout: TIMEOUT_MS,
      });
      console.log("Respuesta API creación de incidente:", JSON.stringify(response.data));

      // 2) El POST responde 201 con el cuerpo vacío: no devuelve el número. El
      // incidente se localiza preguntando al grupo por la descripción exacta,
      // tomando el más reciente. Por eso la descripción debe ir sin retoques.
      let registro: Record<string, any> = {};
      for (let intento = 0; intento < 5 && !registro["Incident Number"]; intento++) {
        if (intento > 0) {
          await new Promise((r) => setTimeout(r, 2500));
        }
        try {
          const consulta = await axios.request({
            url: `${PAGE}/api/arsys/v1.0/entry/HPD:Help%20Desk?q=${encodeURIComponent(
              `'Assigned Group ID'="${grupoElegido.id}"`
            )}`,
            method: "GET",
            headers: headersList,
            timeout: TIMEOUT_MS,
          });
          const coincidencias = (consulta.data?.entries || [])
            .map((e: any) => e.values || {})
            .filter((v: Record<string, any>) => String(v["Description"] || "") === descripcionLimpia)
            .sort((a: Record<string, any>, b: Record<string, any>) =>
              String(b["Submit Date"] || "").localeCompare(String(a["Submit Date"] || ""))
            );
          if (coincidencias.length > 0) {
            registro = coincidencias[0];
          }
        } catch (error) {
          console.error("No se pudo verificar el incidente creado:", error);
        }
      }

      if (!registro["Incident Number"]) {
        Alert.alert(
          "No se pudo crear",
          "Remedy aceptó el envío pero el incidente no apareció en el grupo. Intenta de nuevo."
        );
        return;
      }

      const incidentNumber = String(registro["Incident Number"]);

      // 3) Asignarlo al técnico que está en la app. El formulario de alta no lo
      // hace solo: hay que mandarle el nombre y el login JUNTOS, porque con uno
      // solo Remedy responde que los campos del grupo asignado son inválidos.
      let asignado = false;
      let nombreTecnico = "";
      try {
        const persona = await axios.request({
          url: `${PAGE}/api/arsys/v1.0/entry/CTM:People?q=${encodeURIComponent(
            `'Remedy Login ID'="${username}"`
          )}`,
          method: "GET",
          headers: headersList,
          timeout: TIMEOUT_MS,
        });
        nombreTecnico = String(persona.data?.entries?.[0]?.values?.["Full Name"] || "");
      } catch (error) {
        console.error("No se pudo leer el nombre del técnico:", error);
      }
      if (nombreTecnico && registro["Entry ID"]) {
        try {
          await axios.request({
            url: `${PAGE}/api/arsys/v1.0/entry/HPD:Help%20Desk/${registro["Entry ID"]}`,
            method: "PUT",
            headers: headersList,
            data: JSON.stringify({
              values: { Assignee: nombreTecnico, "Assignee Login ID": username },
            }),
            timeout: TIMEOUT_MS,
          });
          asignado = true;
        } catch (error: any) {
          console.error("No se pudo asignar el incidente al técnico:", JSON.stringify(error?.response?.data) || error);
        }
      }

      // La clave que usa el backend para la georreferenciación es "Request ID"
      // y, si no existe, el Incident Number, igual que su mapper.
      const requestId = String(registro["Request ID"] || incidentNumber);
      const dwpSrid = String(registro["DWP_SRID"] || "Sin ID de petición");
      const prioridadCreada = String(registro["Priority"] || prioridadValores.priority);
      const correoCreado = String(registro["Internet E-mail"] || solicitante.correo || "");

      Alert.alert(
        asignado ? "Incidente creado" : "Incidente creado sin asignar",
        asignado
          ? `N° ${incidentNumber}\nAsignado a ${username} en ${grupoElegido.nombre}.`
          : `N° ${incidentNumber} en ${grupoElegido.nombre}.\n\nNo se pudo asignar a ${username}; asígnalo desde Remedy para que aparezca en tu lista.`,
        [
          {
            text: "Omitir",
            style: "cancel",
            onPress: () => router.replace("/menu"),
          },
          {
            text: "Asignar sede y atender",
            onPress: () =>
              // replace y no push: el caso ya quedó creado, así que el formulario
              // no debe seguir en el historial. Si no, el botón atrás del
              // teléfono traería de vuelta la pantalla con los datos ya usados.
              router.replace({
                pathname: "/asignarSede",
                params: {
                  tipo: "ticket",
                  requestId,
                  dwpSrid,
                  sedeId: "",
                  groupId: grupoElegido.id,
                  groupName: grupoElegido.nombre,
                  incidentNumber,
                  cliente: solicitante.nombre,
                  email: correoCreado,
                  priority: prioridadCreada,
                  continuarA: "detalle",
                },
              }),
          },
        ]
      );
    } catch (error: any) {
      const respuesta = error?.response?.data;
      const detalleHelix = Array.isArray(respuesta)
        ? respuesta[0]?.messageAppendedText || respuesta[0]?.messageText
        : respuesta?.message || error?.message;
      console.error("Error al crear el incidente:", JSON.stringify(respuesta) || error);
      Alert.alert(
        "No se pudo crear",
        detalleHelix || "Remedy rechazó la creación. Intenta de nuevo."
      );
    } finally {
      setCreando(false);
    }
  };

  if (cargando) {
    return (
      <View style={styles.pantallaCargando}>
        <ActivityIndicator size="large" color="#1976d2" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Crear incidente</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.grupo}>
          <Text style={styles.etiqueta}>Solicitante *</Text>
          {solicitante ? (
            <View style={styles.solicitanteElegido}>
              <View style={styles.solicitanteTexto}>
                <Text style={styles.solicitanteNombre}>{solicitante.nombre}</Text>
                <Text style={styles.solicitanteDetalle}>
                  {solicitante.login}
                  {solicitante.correo ? ` · ${solicitante.correo}` : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSolicitante(null)}>
                <Text style={styles.cambiar}>Cambiar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder={`Escribe el nombre (mínimo ${MIN_BUSQUEDA} letras)`}
                value={busqueda}
                onChangeText={setBusqueda}
                autoCapitalize="words"
              />
              {buscando ? (
                <ActivityIndicator size="small" color="#1976d2" style={styles.buscando} />
              ) : null}
              {resultados.length > 0 ? (
                <View style={styles.resultados}>
                  {resultados.map((p) => (
                    <TouchableOpacity
                      key={p.personId || p.login || p.nombre}
                      style={styles.resultadoItem}
                      onPress={() => elegirSolicitante(p)}
                    >
                      <Text style={styles.resultadoNombre}>{p.nombre}</Text>
                      <Text style={styles.resultadoDetalle}>
                        {p.login}
                        {p.correo ? ` · ${p.correo}` : ""}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </View>

        <Desplegable
          etiqueta="Prioridad *"
          placeholder="Selecciona la prioridad"
          valor={prioridad}
          textoSeleccionado={prioridad}
          opciones={(Object.keys(PRIORIDADES) as Prioridad[]).map((p) => ({
            valor: p,
            texto: p,
          }))}
          onChange={(v) => setPrioridad(v as Prioridad)}
        />

        <View style={styles.grupo}>
          <Text style={styles.etiqueta}>Descripción *</Text>
          <TextInput
            style={styles.areaTexto}
            multiline
            numberOfLines={5}
            placeholder="Describe el problema que se va a reportar..."
            value={descripcion}
            onChangeText={setDescripcion}
          />
        </View>

        <Desplegable
          etiqueta="Grupo *"
          placeholder={
            grupos.length === 0 ? "No tienes grupos Ruta" : "Selecciona el grupo"
          }
          valor={grupoId}
          textoSeleccionado={grupoElegido?.nombre}
          opciones={grupos.map((g) => ({ valor: g.id, texto: g.nombre }))}
          onChange={setGrupoId}
          deshabilitado={grupos.length === 0}
        />
      </ScrollView>

      <View style={styles.pie}>
        <TouchableOpacity
          style={[styles.botonGuardar, !listoParaCrear && styles.botonGuardarOff]}
          onPress={crear}
          disabled={creando || !listoParaCrear}
        >
          {creando ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.botonGuardarText}>Crear incidente</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default CrearIncidente;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  pantallaCargando: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#1976d2",
    paddingTop: 50,
  },
  backButton: {
    marginRight: 10,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flexShrink: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 14,
    paddingBottom: 24,
  },
  grupo: {
    marginBottom: 16,
  },
  etiqueta: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  areaTexto: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 12,
    minHeight: 110,
    textAlignVertical: "top",
    fontSize: 15,
    color: "#333",
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 12,
    fontSize: 15,
    color: "#333",
  },
  cajaDesplegable: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  capaDeshabilitada: {
    opacity: 0.5,
  },
  desplegableTexto: {
    fontSize: 15,
    color: "#333",
    flexShrink: 1,
  },
  desplegableVacio: {
    fontSize: 15,
    color: "#9e9e9e",
    flexShrink: 1,
  },
  desplegableFlecha: {
    fontSize: 14,
    color: "#666",
    marginLeft: 8,
  },
  modalFondo: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  modalCaja: {
    backgroundColor: "#fff",
    borderRadius: 10,
    maxHeight: "75%",
    padding: 14,
  },
  modalTitulo: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginBottom: 10,
  },
  modalOpcion: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  modalOpcionSel: {
    backgroundColor: "#eef4fd",
  },
  modalTexto: {
    flex: 1,
  },
  modalOpcionTexto: {
    fontSize: 15,
    color: "#333",
  },
  modalOpcionTextoSel: {
    color: "#1976d2",
    fontWeight: "700",
  },
  modalDetalle: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  modalVacio: {
    textAlign: "center",
    color: "#666",
    paddingVertical: 20,
  },
  modalCerrar: {
    marginTop: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCerrarTexto: {
    color: "#1976d2",
    fontWeight: "700",
    fontSize: 15,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#9e9e9e",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  radioSel: {
    borderColor: "#1976d2",
  },
  radioPunto: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#1976d2",
  },
  buscando: {
    alignSelf: "flex-start",
    marginTop: 8,
  },
  resultados: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    overflow: "hidden",
  },
  resultadoItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  resultadoNombre: {
    fontSize: 15,
    color: "#333",
  },
  resultadoDetalle: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  solicitanteElegido: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eef4fd",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1976d2",
    padding: 12,
  },
  solicitanteTexto: {
    flex: 1,
  },
  solicitanteNombre: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1976d2",
  },
  solicitanteDetalle: {
    fontSize: 12,
    color: "#555",
    marginTop: 2,
  },
  cambiar: {
    color: "#1976d2",
    fontWeight: "700",
    fontSize: 14,
  },
  pie: {
    padding: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderColor: "#e0e0e0",
  },
  botonGuardar: {
    backgroundColor: "#1976d2",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  botonGuardarOff: {
    backgroundColor: "#b0bec5",
  },
  botonGuardarText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
