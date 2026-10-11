/* Sirve el cotizador ENTERO en tu máquina: el sitio y el API, en un solo puerto.
 *
 *   cd api && npm run server     ->  http://localhost:8787
 *   npm run local                ->  lo mismo, desde la raíz del proyecto
 *   PUERTO=9000 npm run server   ->  otro puerto
 *   BASE_LOCAL=/Volumes/Disco/cotizador npm run server   ->  la base en otro lado
 *
 * Usa exactamente el mismo código que se despliega (functions/api.js), así que lo
 * que probás acá es lo real. Lo único que cambia es de dónde salen los datos:
 *   · la BASE LOCAL del proyecto por defecto (api/datos, ver tools/base-local.js):
 *     Postgres (PGlite) guardado en una carpeta tuya, sin internet y sin Neon;
 *   · el Postgres de Neon, si hay DATABASE_URL y no pusiste BASE_LOCAL.
 * La regla completa está en `usarBaseLocal()`, en base-local.js.
 *
 * Como además sirve el sitio (index.html, css/, js/, icons/), el navegador habla
 * con el mismo origen: no hacen falta CORS, ni HTTPS, ni un segundo servidor de
 * archivos, ni `netlify dev` (que en algunas versiones del CLI no arranca).
 *
 * Para los demás puestos del taller: entrá desde ellos a http://<IP-de-esta-PC>:8787.
 * Ese origen se habilita solo, no hay que tocar APP_ORIGEN. */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";

import { cargarEnv } from "./conectar.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");      // donde vive index.html

cargarEnv();

const puerto = Number(process.env.PUERTO || 8787);

/* --------------------------------- El API --------------------------------- */
// Se importa DESPUÉS de cargarEnv(): el archivo lee las variables al importarse.
const { crearApp, opcionesDeEntorno, consultarNeon } = await import("../functions/api.js");
const { abrirBaseLocal, usarBaseLocal } = await import("./base-local.js");

let base = null;
if (usarBaseLocal()) {
  base = await abrirBaseLocal();
  console.log("Base: local en " + base.carpeta + (base.nueva ? " (la creé recién)" : ""));
} else {
  console.log("Base: Neon (DATABASE_URL de api/.env)");
}

// Este servidor sirve también el sitio, así que el navegador entra por SU origen:
// hay que permitirlo, porque un POST desde la propia página manda Origin y, si no
// está en la lista, el API contesta 403. Se suman las IP de la red local para que
// los demás puestos del taller entren por http://<IP>:<puerto> sin tocar el .env.
function origenesPropios(puerto) {
  const dirs = ["http://localhost:" + puerto, "http://127.0.0.1:" + puerto];
  for (const lista of Object.values(networkInterfaces())) {
    for (const dir of lista || []) {
      if (dir.family === "IPv4" && !dir.internal) dirs.push("http://" + dir.address + ":" + puerto);
    }
  }
  return dirs;
}

const opciones = opcionesDeEntorno(base ? base.query : consultarNeon);
opciones.origenPermitido = [opciones.origenPermitido, ...origenesPropios(puerto)]
  .filter(Boolean).join(",");

const app = crearApp(opciones);

/* -------------------------------- El sitio -------------------------------- */
// Sólo se sirven archivos del sitio. api/ (ahí está el .env con la cadena y la
// contraseña), node_modules/, .git/ y las carpetas ocultas quedan afuera: sin esa
// lista, http://localhost:8787/api/.env entregaría las credenciales.
const PROHIBIDAS = ["api", "db", "node_modules"];
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

// Devuelve la ruta del archivo, o null si no corresponde servirla.
function archivoDe(url) {
  let rel;
  try {
    rel = decodeURIComponent(String(url).split("?")[0]);
  } catch {
    return null;                       // %-encoding roto
  }
  if (rel.endsWith("/")) rel += "index.html";
  const partes = rel.split("/").filter(Boolean);
  if (partes.some((p) => p.startsWith(".") || PROHIBIDAS.includes(p))) return null;

  const destino = resolve(RAIZ, ...partes);
  if (destino !== RAIZ && !destino.startsWith(RAIZ + sep)) return null;   // nada fuera del sitio

  try {
    const info = statSync(destino);
    if (info.isDirectory()) return archivoDe(rel + "/");
    return info.isFile() ? destino : null;
  } catch {
    return null;                       // no existe: 404
  }
}

// Cabeceras que no conviene copiar tal cual (las recalcula Node solo).
const IGNORADAS = ["connection", "host", "content-length", "transfer-encoding", "expect"];

const servidor = createServer(async (peticion, respuesta) => {
  async function contestar(estado, cabeceras, cuerpo) {
    respuesta.writeHead(estado, cabeceras);
    respuesta.end(cuerpo);
  }

  try {
    // Todo lo que no sea /api es el sitio: se sirve del disco, tal cual.
    if (!String(peticion.url).startsWith("/api")) {
      const archivo = archivoDe(peticion.url);
      if (!archivo) {
        return contestar(404, { "Content-Type": "text/plain; charset=utf-8" },
          "No está: " + peticion.url + "\n");
      }
      return contestar(200, {
        "Content-Type": TIPOS[extname(archivo).toLowerCase()] || "application/octet-stream",
        // Sin caché: mientras desarrollás, recargar tiene que traer el JS nuevo.
        "Cache-Control": "no-store"
      }, readFileSync(archivo));
    }

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
  console.log("Cotizador servido en http://localhost:" + puerto + "   (abrilo en el navegador)");
  console.log("Sin navegador:  curl -s localhost:" + puerto + "/api");
  console.log("Otros puestos del taller: http://<IP-de-esta-PC>:" + puerto + "   ·   Cortá con Ctrl+C.");
});

// Ctrl+C cierra la base con cuidado: PGlite vuelca al disco al cerrar y se libera
// el candado de la carpeta (si se corta de golpe, el candado queda con el pid
// muerto y el próximo que la abra lo toma igual, pero mejor cerrar bien).
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    servidor.close(async () => {
      if (base) await base.cerrar();
      process.exit(0);
    });
  });
}
