/* Deja la cuenta del acceso automático igual a lo que dice api/.env.
 *   cd api && npm run acceso
 *
 * Es el puente entre el .env y la base: la contraseña vive en claro SÓLO en tu
 * .env (no se sube nunca al repositorio) y en Postgres queda su hash scrypt,
 * igual que con `npm run usuario`. Corrélo después de cambiar ACCESO_EMAIL o
 * ACCESO_CLAVE, o para crear la cuenta la primera vez.
 *
 * Si ACCESO_AUTOMATICO no está prendido, la cuenta queda igual de lista pero se
 * avisa: en ese caso la app pide el correo y esta clave se escribe a mano.
 *
 * Nunca imprime la contraseña: sale del .env y ahí la podés leer o cambiar. */
import { pathToFileURL } from "node:url";

import { hashPassword } from "./crear-usuario.js";
import { cargarEnv, conectar } from "./conectar.js";

// Mismos valores que acepta el API (api/functions/api.js, esVerdadero).
const VERDADEROS = ["1", "true", "si", "sí", "on", "yes", "verdadero"];
const prendido = (valor) => VERDADEROS.includes(String(valor == null ? "" : valor).trim().toLowerCase());

async function main() {
  cargarEnv();

  const email = String(process.env.ACCESO_EMAIL || "").trim().toLowerCase();
  const clave = String(process.env.ACCESO_CLAVE || "");
  const nombre = String(process.env.ACCESO_NOMBRE || "").trim() || email.split("@")[0];
  const automatico = prendido(process.env.ACCESO_AUTOMATICO);

  if (!email || !clave) {
    console.error("Faltan ACCESO_EMAIL y/o ACCESO_CLAVE en api/.env.");
    console.error("Descomentá el bloque «Acceso automático» de api/.env (está en api/.env.example) y volvé a correrlo.");
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("ACCESO_EMAIL no parece un correo: " + email);
    process.exit(1);
  }
  if (clave.length < 8) {
    console.error("ACCESO_CLAVE necesita al menos 8 caracteres.");
    process.exit(1);
  }

  const { query, cerrar } = await conectar();
  try {
    const previo = await query("select id from usuarios where email = $1", [email]);
    const hash = await hashPassword(clave);
    // Mismo camino que `npm run usuario`: si el correo ya está, se actualiza la
    // clave y se lo vuelve a activar (sirve de «olvidé mi contraseña»).
    const { rows } = await query(
      "insert into usuarios (email, nombre, password_hash, activo) values ($1, $2, $3, true)" +
      " on conflict (email) do update set nombre = $2, password_hash = $3, activo = true" +
      " returning id, nombre, email",
      [email, nombre.slice(0, 120), hash]
    );
    const usuario = rows[0];

    console.log("─ Acceso automático");
    console.log("  ✓ cuenta " + (previo.rows.length ? "actualizada" : "creada") + ": " +
      usuario.nombre + " <" + usuario.email + "> (con la clave de api/.env)");
    if (automatico) {
      console.log("  ✓ ACCESO_AUTOMATICO está prendido: la app entra sola con esta cuenta.");
      console.log("    Para volver al login normal: ACCESO_AUTOMATICO=\"false\" en api/.env (y en");
      console.log("    las variables del sitio, si esto es producción) y recargar la página.");
    } else {
      console.log("  · ACCESO_AUTOMATICO está apagado: la app pide el correo y esta clave se");
      console.log("    escribe a mano. Prendelo con ACCESO_AUTOMATICO=\"true\" en api/.env.");
    }
    console.log("  · En el sitio desplegado estas variables van en las variables de entorno");
    console.log("    del sitio (Netlify): el .env es sólo para tu máquina y para `netlify dev`.");
  } catch (error) {
    console.error("No se pudo dejar la cuenta lista:", error.message);
    process.exitCode = 1;
  } finally {
    await cerrar();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
