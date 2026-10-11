/* Sirve el API en tu máquina, sin depender del login de Neon.
 *
 *   npm run server                 ->  http://localhost:8787
 *   PUERTO=9000 npm run server     ->  otro puerto
 *
 * Usa la DATABASE_URL de api/.env y exactamente el mismo código que se
 * despliega (functions/api.js), así que lo que probás acá es lo real.
 * Para la versión que sí habla con Neon (inyecta las variables de la rama)
 * está `npm run dev`. Ventaja de este servidor: no necesita `neon link`. */
import { createServer } from "node:http";

import { cargarEnv } from "./conectar.js";

cargarEnv();

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL en api/.env (pegá la cadena de Neon y guardá el archivo).");
  process.exit(1);
}

// Se importa DESPUÉS de cargarEnv(): el archivo arma el pool al importarse.
const { default: app } = await import("../functions/api.js");

const puerto = Number(process.env.PUERTO || 8787);

// Cabeceras que no conviene copiar tal cual (las recalcula Node solo).
const IGNORADAS = ["connection", "host", "content-length", "transfer-encoding", "expect"];

const servidor = createServer(async (peticion, respuesta) => {
  async function contestar(estado, cabeceras, cuerpo) {
    respuesta.writeHead(estado, cabeceras);
    respuesta.end(cuerpo);
  }

  try {
    const trozos = [];
    for await (const trozo of peticion) trozos.push(trozo);
    const cuerpo = trozos.length ? Buffer.concat(trozos) : undefined;

    const cabeceras = {};
    for (const [clave, valor] of Object.entries(peticion.headers)) {
      if (IGNORADAS.includes(clave)) continue;
      cabeceras[clave] = Array.isArray(valor) ? valor.join(", ") : valor;
    }

    const salida = await app.fetch(new Request(
      "http://" + (peticion.headers.host || "localhost") + peticion.url,
      { method: peticion.method, headers: cabeceras, body: cuerpo }
    ));

    const devueltas = {};
    salida.headers.forEach((valor, clave) => { devueltas[clave] = valor; });
    await contestar(salida.status, devueltas, Buffer.from(await salida.arrayBuffer()));
  } catch (error) {
    console.error("Error inesperado:", error);
    await contestar(500, { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({ error: "error inesperado en el servidor local" }));
  }
});

servidor.listen(puerto, () => {
  console.log("API del cotizador escuchando en http://localhost:" + puerto);
  console.log("Comprobalo:  curl -s localhost:" + puerto + "/api");
  console.log("Cortá con Ctrl+C.");
});
