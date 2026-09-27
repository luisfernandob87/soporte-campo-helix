// TypeScript no sabe resolver los imports de imágenes que hace Metro en tiempo
// de ejecución (logo, iconos). Sin esto, cada import de .png/.jpg queda marcado
// como error aunque la app funcione.
declare module '*.png' {
  const contenido: number;
  export default contenido;
}

declare module '*.jpg' {
  const contenido: number;
  export default contenido;
}

declare module '*.jpeg' {
  const contenido: number;
  export default contenido;
}
