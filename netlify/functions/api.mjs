/* Envuelto del API del cotizador para Netlify.
 *
 * El código de verdad es api/functions/api.js, que está escrito contra la
 * interfaz web estándar (recibe un `Request` y devuelve un `Response`). Netlify
 * usa exactamente esa misma interfaz, así que acá no hay que adaptar nada: sólo
 * pasarle la petición.
 *
 * La cadena de conexión NO está acá ni en el repo: llega por la variable de
 * entorno DATABASE_URL del sitio (Site configuration -> Environment variables).
 *
 * En local:  npx netlify dev   ->  http://localhost:8888/api
 */
import app from "../../api/functions/api.js";

export default function manejar(request, context) {
  return app.fetch(request, context);
}

// Todo /api y /api/* entra acá; el router de api.js decide qué ruta es cada
// cosa. No hace falta un redirect en netlify.toml.
export const config = { path: ["/api", "/api/*"] };
