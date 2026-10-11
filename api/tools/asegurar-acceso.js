/* La cuenta del taller: con la que la app entra sola, sin contraseña.
 *   cd api && npm run acceso
 *
 * La app no tiene pantalla de login: al abrirse le pide una sesión al API
 * (POST /api/acceso) y el API se la da con esta cuenta. Por eso, para que el
 * cotizador abra, la base sólo necesita tener una cuenta activa: la clave no se
 * escribe nunca y este comando se corre sobre todo cuando cambiás el correo, el
 * nombre o la clave de api/.env, o la primera vez.
 *
 *   · con ACCESO_EMAIL + ACCESO_CLAVE en el .env -> esa cuenta queda creada (o
 *     actualizada: sirve de «olvidé la contraseña», la clave vieja deja de servir
 *     para /api/login);
 *   · con el .env incompleto y la base sin ninguna cuenta activa -> se crea la
 *     cuenta «taller» para que una máquina nueva abra igual. Es lo que hace
 *     `npm run server` al arrancar, así que no hace falta correrlo a mano.
 *
 * La contraseña vive en claro SÓLO en api/.env (que no se sube al repositorio) y
 * en Postgres queda su hash scrypt, igual que con `npm run usuario`.
 * Nunca imprime la contraseña: sale del .env y ahí la podés leer o cambiar.
 *
 * Se expone para tools/servidor-local.js (que la deja lista al arrancar) además
 * de la línea de comandos: `main()` corre sólo si lo llaman a este archivo. */
import { pathToFileURL } from "node:url";

import { hashPassword } from "./crear-usuario.js";
import { cargarEnv, conectar } from "./conectar.js";

// Cuenta que se crea cuando la base está vacía, para que la app tenga con qué
// entrar aunque el .env todavía no tenga nada.
export const CUENTA_TALLER = { email: "taller@cubica3d.local", nombre: "Taller" };

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Lo que dice el .env, ya normalizado, con la lista de lo que falta.
export function datosDeAcceso() {
  const email = String(process.env.ACCESO_EMAIL || "").trim().toLowerCase();
  const clave = String(process.env.ACCESO_CLAVE || "");
  const nombre = String(process.env.ACCESO_NOMBRE || "").trim() ||
    email.split("@")[0] || CUENTA_TALLER.nombre;

  const faltan = [];
  if (!email) faltan.push("ACCESO_EMAIL");
  else if (!CORREO.test(email)) faltan.push("ACCESO_EMAIL (no parece un correo)");
  if (!clave) faltan.push("ACCESO_CLAVE");
  else if (clave.length < 8) faltan.push("ACCESO_CLAVE (necesita al menos 8 caracteres)");

  return { email, clave, nombre, faltan };
}

// Deja la cuenta en la base: la crea si no está y, si está, le vuelve a poner el
// nombre y la clave del .env. Devuelve { usuario, creada }.
export async function asegurarCuentaDeAcceso(query, datos) {
  const { email, clave, nombre } = datos || datosDeAcceso();
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
  return { usuario: rows[0], creada: previo.rows.length === 0 };
}

async function hayCuentaActiva(query) {
  const { rows } = await query("select 1 from usuarios where activo limit 1");
  return rows.length > 0;
}

/* Deja la base en condiciones de que la app entre sola. La llama el servidor
 * local al arrancar, así que nunca rompe nada: avisa por `avisar` (una función,
 * por defecto silencio) y sigue. Devuelve { usuario, creada, motivo } o null. */
export async function prepararCuentaDeAcceso(query, avisar) {
  const log = avisar || (() => {});
  const datos = datosDeAcceso();

  if (!datos.faltan.length) {
    return Object.assign(await asegurarCuentaDeAcceso(query, datos), { motivo: "env" });
  }

  if (await hayCuentaActiva(query)) {
    log("el .env no tiene " + datos.faltan.join(" y ") + ": se entra con la cuenta que ya está en la base");
    return null;
  }

  // Base recién creada y .env sin cuenta: se crea una para que la app pueda
  // entrar. La clave es al azar y no la sabe nadie: la app entra sin escribirla.
  const inicial = Object.assign({}, CUENTA_TALLER, {
    clave: "sin-clave-" + Math.random().toString(36).slice(2, 12) + "-local"
  });
  return Object.assign(await asegurarCuentaDeAcceso(query, inicial), { motivo: "taller" });
}

/* -------------------------- `npm run acceso` -------------------------- */
async function main() {
  cargarEnv();

  const datos = datosDeAcceso();
  if (datos.faltan.length) {
    console.error("Faltan datos en api/.env: " + datos.faltan.join(", ") + ".");
    console.error("Descomentá el bloque «Acceso del taller» de api/.env (el ejemplo está en");
    console.error("api/.env.example) y volvé a correrlo.");
    process.exit(1);
  }

  const { query, cerrar } = await conectar();
  try {
    const { usuario, creada } = await asegurarCuentaDeAcceso(query, datos);

    console.log("─ Cuenta del taller (con la que la app entra sola, sin contraseña)");
    console.log("  ✓ cuenta " + (creada ? "creada" : "actualizada") + ": " +
      usuario.nombre + " <" + usuario.email + ">");
    console.log("  ✓ la app entra con esta cuenta por POST /api/acceso: no hay que escribir nada.");
    console.log("  · para cerrar el acceso: ACCESO_LIBRE=\"false\" en api/.env (y en las variables");
    console.log("    del sitio, si esto es producción). Ahí /api/acceso no entrega sesión y se entra");
    console.log("    sólo por POST /api/login, con correo y contraseña.");
    console.log("  · en el sitio desplegado estas variables van en las variables de entorno del");
    console.log("    sitio (Netlify): el .env es sólo para tu máquina y para `npm run server`.");
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
