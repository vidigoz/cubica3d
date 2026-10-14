/* Devuelve `{ query, exec, cerrar, motor }` con la base que corresponda:
 *
 *   · con DATABASE_URL (o DATABASE_URL_UNPOOLED) en el .env o en el entorno ->
 *     Postgres de Neon/remoto, como siempre;
 *   · sin ninguna de las dos -> la base local del proyecto (api/datos), que
 *     levanta base-local.js: es Postgres igual (PGlite) y se crea sola la primera
 *     vez, así que todos los comandos funcionan sin nube y sin tocar nada.
 *
 * `query(sql, parametros)` es idéntico en los dos casos, que es justo lo que
 * necesitan los utilitarios. `exec(sql)` es para el SQL de varios comandos de una
 * sola vez (db/schema.sql): sin parámetros, porque va por el protocolo simple.
 *
 * Sin dependencias para leer la configuración: se leen api/.env y api/.env.local
 * (en ese orden) y lo que ya esté exportado en el entorno tiene prioridad (podés
 * hacer `export DATABASE_URL=...` y se usa eso). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { abrirBaseLocal, usarBaseLocal } from "./base-local.js";

const AQUI = dirname(fileURLToPath(import.meta.url));

/* Lee un archivo .env (formato CLAVE="valor") sin dependencias.
 * Un valor vacío —una línea todavía sin completar— no pisa ni bloquea lo que
 * ya venga del entorno o del otro archivo. Si el archivo no existe, no hace nada. */
function leerArchivo(archivo) {
  let contenido;
  try {
    contenido = readFileSync(archivo, "utf8");
  } catch {
    return;
  }
  for (const linea of contenido.split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte < 1) continue;
    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    const comilla = valor[0];
    if ((comilla === '"' || comilla === "'") && valor.endsWith(comilla)) valor = valor.slice(1, -1);
    if (valor && !process.env[clave]) process.env[clave] = valor;
  }
}

export function cargarEnv() {
  // `neon env pull` escribe en .env si ya existe, y si no en .env.local:
  // leemos los dos, y lo que ya venga del entorno tiene prioridad.
  leerArchivo(join(AQUI, "..", ".env"));
  leerArchivo(join(AQUI, "..", ".env.local"));
}

export async function conectar() {
  cargarEnv();

  if (usarBaseLocal()) {
    // BASE_LOCAL puesta, o no hay DATABASE_URL: la base vive en el proyecto.
    const base = await abrirBaseLocal();
    console.log("Base: local (" + base.carpeta + ")" +
      (base.nueva ? " — la creé recién con db/schema.sql" : "") +
      "   ·   para usar Neon, sacá BASE_LOCAL y poné DATABASE_URL en api/.env");
    return { query: base.query, exec: base.exec, cerrar: base.cerrar, motor: "local" };
  }

  const cadena = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

  const pg = (await import("pg")).default;
  // connectionTimeoutMillis: sin esto, una cadena mal pegada deja el comando
  // colgado para siempre en vez de avisar que no pudo conectar.
  const pool = new pg.Pool({ connectionString: cadena, max: 2, connectionTimeoutMillis: 15000 });
  return {
    query: (sql, parametros) => pool.query(sql, parametros),
    // Sin parámetros, `pg` va por el protocolo simple y acepta varios comandos de
    // una sola vez (es lo que necesita `npm run schema` con db/schema.sql).
    exec: (sql) => pool.query(sql),
    cerrar: () => pool.end(),
    motor: "postgres"
  };
}
