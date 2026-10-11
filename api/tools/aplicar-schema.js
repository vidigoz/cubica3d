/* Aplica db/schema.sql sobre la base vinculada (una sola vez, base vacía).
 *   cd api && npm run schema
 * Alternativa sin Node:  psql "$DATABASE_URL_UNPOOLED" -f db/schema.sql */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { conectar } from "./conectar.js";

const RUTA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "schema.sql");

const { query, cerrar } = await conectar();
try {
  await query(readFileSync(RUTA, "utf8"));
  const { rows } = await query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
  );
  console.log("Listo. Tablas en la base: " + rows.map((f) => f.table_name).join(", "));
} catch (error) {
  console.error("No se pudo aplicar el esquema:", error.message);
  process.exitCode = 1;
} finally {
  await cerrar();
}
