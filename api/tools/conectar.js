/* Conexión a Postgres para los utilitarios de línea de comandos.
 *
 * El runtime de Neon inyecta DATABASE_URL sola en la función desplegada; acá
 * (en tu máquina) hay que leerla del .env que deja `neon env pull` o que
 * completaste a mano.
 * Sin dependencias: se leen api/.env y api/.env.local (en ese orden) y lo que
 * ya esté exportado en el entorno tiene prioridad (podés hacer
 * `export DATABASE_URL=...` y se usa eso). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  const cadena = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!cadena) {
    console.error("Falta DATABASE_URL. Corré `neon env pull` dentro de api/ o exportá la variable.");
    process.exit(1);
  }
  const pg = (await import("pg")).default;
  // connectionTimeoutMillis: sin esto, una cadena mal pegada deja el comando
  // colgado para siempre en vez de avisar que no pudo conectar.
  const pool = new pg.Pool({ connectionString: cadena, max: 2, connectionTimeoutMillis: 15000 });
  return {
    query: (sql, parametros) => pool.query(sql, parametros),
    cerrar: () => pool.end()
  };
}
