/* Revisa la configuración local y la base, sin exponer credenciales.
 *
 *   npm run revisar          (equivale a: node tools/revisar.js)
 *
 * Contesta: ¿está la cadena en api/.env y tiene la forma esperada? ¿la base
 * responde? ¿en qué región está? ¿están las tablas? ¿hay usuarios creados?
 * Nunca imprime la contraseña ni el host completo: sólo lo necesario. */
import { cargarEnv, conectar } from "./conectar.js";

const ESPERADAS = [
  "configuracion", "cotizaciones", "cotizacion_items",
  "folios", "movimientos", "sesiones", "usuarios"
];
// Regiones donde existen las Neon Functions (las del host de Neon).
const REGIONES_OK = ["us-east-1", "us-east-2", "eu-central-1", "ap-southeast-1"];

cargarEnv();

const url = process.env.DATABASE_URL || "";
const directa = process.env.DATABASE_URL_UNPOOLED || "";

console.log("─ Archivo api/.env");
if (!url && !directa) {
  console.log("  ✗ No hay ninguna cadena cargada.");
  console.log("    Pegá la cadena de Neon en la línea DATABASE_URL y guardá el archivo (Cmd+S).");
  process.exit(1);
}
if (url) {
  const region = (url.match(/\.([a-z]{2}-[a-z]+-\d)\./) || [])[1] || "desconocida";
  const conPooler = /-pooler\./.test(url);
  console.log("  ✓ DATABASE_URL: " + url.length + " caracteres, " +
    (conPooler ? "con" : "SIN") + " -pooler, región " + region);
  if (!conPooler) console.log("    (la de producción es la que tiene -pooler)");
  console.log("    " + (REGIONES_OK.includes(region)
    ? "esa región ofrece Neon Functions: el API puede vivir ahí"
    : "OJO: esa región no ofrece Neon Functions"));
} else {
  console.log("  ✓ DATABASE_URL vacía: se usa DATABASE_URL_UNPOOLED");
}
if (directa) console.log("  ✓ DATABASE_URL_UNPOOLED cargada (es la que usan estos utilitarios)");

// ------------------------------------------------------------------- La base
console.log("");
const inicio = Date.now();
let query, cerrar;
try {
  ({ query, cerrar } = await conectar());
  const { rows } = await query("select version() as version");
  console.log("─ Conexión");
  console.log("  ✓ la base responde (" + (Date.now() - inicio) + " ms), Postgres " +
    ((String(rows[0].version).match(/PostgreSQL ([\d.]+)/) || [])[1] || "?"));

  const tablas = (await query(
    "select tablename from pg_tables where schemaname = 'public' order by tablename"
  )).rows.map((f) => f.tablename);

  console.log("");
  console.log("─ Tablas");
  const faltan = ESPERADAS.filter((t) => !tablas.includes(t));
  if (faltan.length) {
    console.log("  ✗ faltan " + faltan.length + ": " + faltan.join(", "));
    console.log("    Corré: npm run schema");
  } else {
    console.log("  ✓ están las 7 tablas del cotizador");
  }
  const otras = tablas.filter((t) => !ESPERADAS.includes(t));
  if (otras.length) console.log("  (además hay: " + otras.join(", ") + ")");

  console.log("");
  console.log("─ Folios y usuarios");
  const { rows: funciones } = await query(
    "select count(*)::int as n from pg_proc where proname = 'siguiente_folio'"
  );
  console.log("  " + (funciones[0].n ? "✓" : "✗") + " función siguiente_folio()");
  if (funciones[0].n) {
    const { rows: folio } = await query("select ultimo from folios where id = 'default'");
    if (folio.length) console.log("    contador de folios en " + folio[0].ultimo);
  }
  if (tablas.includes("usuarios")) {
    const { rows } = await query(
      "select count(*)::int as total, (count(*) filter (where activo))::int as activos from usuarios"
    );
    const { total, activos } = rows[0];
    console.log("  " + (activos ? "✓" : "✗") + " usuarios activos: " + activos + " de " + total);
    if (!activos) {
      console.log("    Creá el primero:  npm run usuario -- \"correo@dominio.com\" \"Nombre\" \"contraseña\"");
    }
  }
} catch (error) {
  console.log("─ Conexión");
  console.log("  ✗ no pude conectar: " + (error.message || error));
  console.log("    Revisá el mensaje de arriba: si la base es la de Neon, fijate que la");
  console.log("    cadena esté completa y el proyecto activo; si es la local, que no la");
  console.log("    tenga abierta el servidor (`npm run server`).");
} finally {
  if (cerrar) await cerrar();
}
