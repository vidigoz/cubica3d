/* Aplica db/schema.sql sobre la base vinculada (la de api/.env: Neon o la local).
 * Se puede correr las veces que haga falta: el esquema es idempotente y al final
 * trae las órdenes que ponen al día una base que ya estaba en uso (una columna
 * nueva, un check nuevo) sin borrar ni pisar datos.
 *   cd api && npm run schema
 * Con la base local (api/datos) hay que cortar el servidor antes: PGlite admite un
 * solo proceso por vez sobre la carpeta.
 * Alternativa sin Node:  psql "$DATABASE_URL_UNPOOLED" -f db/schema.sql */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { conectar } from "./conectar.js";

const RUTA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "schema.sql");

const { query, exec, cerrar } = await conectar();
try {
  // `exec` (y no `query`): db/schema.sql trae varias órdenes y `query` las manda
  // como sentencia preparada, que sólo admite una.
  const correr = exec || query;
  await correr(readFileSync(RUTA, "utf8"));
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
