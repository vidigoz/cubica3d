/* El servidor MCP del cotizador en Netlify: https://<sitio>/mcp
 *
 * El código está en api/functions/mcp.js y usa el mismo API (api/functions/api.js) por
 * dentro. Las llaves llegan por las variables de entorno del sitio
 * (Site configuration -> Environment variables):
 *   MCP_LLAVE_LECTURA    sólo consulta
 *   MCP_LLAVE_ESCRITURA  consulta + crear cotizaciones */
import app from "../../api/functions/api.js";
import { crearMcp } from "../../api/functions/mcp.js";

const mcp = crearMcp(app, {
  lectura: process.env.MCP_LLAVE_LECTURA,
  escritura: process.env.MCP_LLAVE_ESCRITURA
});

export default function manejar(request) {
  return mcp.fetch(request);
}

export const config = { path: ["/mcp"] };
