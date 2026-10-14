/* La base del cotizador adentro del proyecto: Postgres guardado en una carpeta,
 * sin Neon, sin cuentas y sin internet.
 *
 *   api/datos/                      <- la base entera (copiar la carpeta = respaldo)
 *   cd api && npm run base-local    <- la crea y muestra cómo va
 *
 * Es Postgres de verdad (PGlite: el mismo motor compilado a WebAssembly) y se le
 * aplica el MISMO db/schema.sql que a Neon, así que no hay dos SQL que mantener ni
 * dos comportamientos que probar: lo que pasa `npm run test:db` es lo que corre
 * acá.
 *
 * Se usa sola cuando no hay DATABASE_URL: `npm run server` y los utilitarios
 * (usuario, acceso, revisar...) la levantan así por defecto. Si pegás
 * DATABASE_URL en api/.env, gana Neon y esto queda de lado.
 *
 * Dos límites, para tenerlos presentes:
 *   · un solo proceso por vez sobre la carpeta: PGlite no tiene el candado de un
 *     Postgres con postmaster, así que el candado de acá lo avisa en castellano
 *     en lugar de arriesgar los datos. Para mantenimiento, cortá el servidor.
 *   · una sola máquina sirve a todos los puestos del taller. No la pongas en la
 *     nube: en una función de Netlify el disco es efímero y se perdería todo.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ESQUEMA = join(AQUI, "..", "..", "db", "schema.sql");
const CANDADO = ".en-uso";

const esSi = (valor) => ["1", "true", "si", "sí", "on", "yes"].includes(String(valor).trim().toLowerCase());

export function rutaBaseLocal() {
  // BASE_LOCAL permite tenerla en otro lado (un disco externo, por ejemplo).
  const pedido = String(process.env.BASE_LOCAL || "").trim();
  if (pedido && !esSi(pedido)) return resolve(pedido);
  return join(AQUI, "..", "datos");
}

/* ¿Hay que usar la base local? Manda BASE_LOCAL:
 *   · BASE_LOCAL puesta (true, 1, o una ruta) -> base local, aunque haya DATABASE_URL;
 *   · sin BASE_LOCAL y con DATABASE_URL       -> Neon/Postgres remoto;
 *   · sin nada de lo dos                      -> base local (la del proyecto).
 * El `true` explícito sirve cuando querés la base del proyecto pero igual tenés
 * la cadena de Neon guardada en el .env para `netlify dev`. */
export function usarBaseLocal() {
  if (String(process.env.BASE_LOCAL || "").trim()) return true;
  return !(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
}

/* El candado: se deja el pid del proceso que la tiene abierta y, si ese proceso
 * sigue vivo, se avisa en vez de dejar que dos escritores se pisen. Un candado
 * viejo (proceso que ya no está) se toma sin drama. */
function tomarCandado(carpeta) {
  const archivo = join(carpeta, CANDADO);
  if (existsSync(archivo)) {
    const pid = Number(readFileSync(archivo, "utf8").trim());
    let vivo = false;
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        vivo = true;
      } catch (error) {
        vivo = error.code === "EPERM";   // existe, pero es de otro usuario
      }
    }
    if (vivo) {
      throw new Error(
        "La base local todavía la tiene abierta el proceso " + pid + ".\n" +
        "  Cortá ese proceso (por ejemplo el servidor, con Ctrl+C) y volvé a intentar:\n" +
        "  PGlite admite un solo proceso por vez sobre " + carpeta + "."
      );
    }
  }
  writeFileSync(archivo, String(process.pid));
  return function soltar() {
    try {
      rmSync(archivo);
    } catch {
      /* ya no estaba: da igual */
    }
  };
}

let abierta = null;

/* Abre (y la primera vez crea) la base local. Devuelve `{ carpeta, nueva, query,
 * cerrar }`, donde `query(sql, parametros)` es igual que el de `pg`, así que el
 * API y los utilitarios la usan sin enterarse de la diferencia. */
export async function abrirBaseLocal() {
  if (abierta) return abierta;

  const carpeta = rutaBaseLocal();
  mkdirSync(carpeta, { recursive: true });
  const soltar = tomarCandado(carpeta);

  let db;
  try {
    const { PGlite } = await import("@electric-sql/pglite");
    db = new PGlite(carpeta);
    await db.waitReady;

    // ¿Es la primera vez? Se mira si ya están las tablas; si no, se aplica el
    // esquema entero (que es el mismo de Neon y ya es idempotente).
    const { rows } = await db.query(
      "select table_name from information_schema.tables" +
      " where table_schema = 'public' and table_name = 'cotizaciones' limit 1"
    );
    const nueva = rows.length === 0;
    if (nueva) await db.exec(readFileSync(ESQUEMA, "utf8"));

    abierta = {
      carpeta: carpeta,
      nueva: nueva,
      query: (sql, parametros) => db.query(sql, parametros),
      // `exec` es para el SQL de varios comandos (db/schema.sql): `query` manda
      // cada orden como sentencia preparada y Postgres sólo admite una por vez.
      exec: (sql) => db.exec(sql),
      // Volcado de toda la base en un .tar.gz (para copiar a otro lado).
      volcar: () => db.dumpDataDir("gzip"),
      cerrar: async function () {
        if (!abierta) return;
        abierta = null;
        await db.close();
        soltar();
      }
    };
    return abierta;
  } catch (error) {
    if (db) { try { await db.close(); } catch { /* nada que cerrar */ } }
    soltar();
    throw error;
  }
}

export { ESQUEMA as RUTA_ESQUEMA };

/* ------------------------- `npm run base-local` ------------------------- */
// Sin argumentos: dice dónde está, cómo va y cómo respaldarla.
// Con --respaldo: además escribe api/respaldos/base-fecha.tar.gz
async function main() {
  const { cargarEnv } = await import("./conectar.js");
  cargarEnv();

  const base = await abrirBaseLocal();
  const cuenta = (sql) => base.query(sql).then((r) => r.rows[0].n);

  console.log("─ Base local del cotizador");
  console.log("  " + base.carpeta + (base.nueva ? "  (la acabo de crear con db/schema.sql)" : ""));
  console.log("  " + await cuenta("select count(*)::int as n from usuarios") + " cuenta(s), " +
    await cuenta("select count(*)::int as n from cotizaciones where borrada_en is null") +
    " tarjeta(s) en el tablero, " +
    await cuenta("select count(*)::int as n from cotizaciones where borrada_en is not null") +
    " quitada(s) del tablero");

  if (process.argv.includes("--respaldo")) {
    const carpeta = join(AQUI, "..", "respaldos");
    mkdirSync(carpeta, { recursive: true });
    const fecha = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const destino = join(carpeta, "base-" + fecha + ".tar.gz");
    const volcado = await base.volcar();
    writeFileSync(destino, Buffer.from(await volcado.arrayBuffer()));
    console.log("  respaldo escrito: " + destino);
  } else {
    console.log("  respaldo: `npm run base-local -- --respaldo` o copiá la carpeta entera");
  }

  console.log("  la usan `npm run server` y los utilitarios (usuario, acceso, revisar...):");
  console.log("  si no hay BASE_LOCAL ni DATABASE_URL; con DATABASE_URL y sin BASE_LOCAL, usan Neon");
  await base.cerrar();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(function (error) {
    console.error(error.message);
    process.exitCode = 1;
  });
}

