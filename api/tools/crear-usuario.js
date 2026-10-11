/* Crea o actualiza un usuario del cotizador.
 *   cd api && npm run usuario -- "correo@cubica3d.com" "Ana" "una-clave-larga"
 *
 * Volver a correrlo con el mismo correo cambia la contraseña (sirve de
 * "olvidé mi contraseña": no hay correo saliente en este proyecto, así que el
 * reseteo se hace a mano desde la terminal). */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

// OJO: el formato tiene que ser idéntico al de api/functions/api.js
// (scrypt$<N>$<sal base64>$<hash base64>). El test __api.test.js comprueba que
// los dos archivos coincidan, así que si cambiás uno, cambiá el otro.
const SCRYPT = { N: 16384, r: 8, p: 1, largo: 64, sal: 16 };

export function hashPassword(password) {
  return new Promise(function (resolver, rechazar) {
    const sal = randomBytes(SCRYPT.sal);
    scrypt(password, sal, SCRYPT.largo, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, function (error, clave) {
      if (error) return rechazar(error);
      resolver("scrypt$" + SCRYPT.N + "$" + sal.toString("base64") + "$" + clave.toString("base64"));
    });
  });
}

export function verificarPassword(password, guardado) {
  return new Promise(function (resolver) {
    if (typeof password !== "string" || typeof guardado !== "string") return resolver(false);
    const partes = guardado.split("$");
    if (partes.length !== 4 || partes[0] !== "scrypt") return resolver(false);
    const N = parseInt(partes[1], 10);
    const sal = Buffer.from(partes[2], "base64");
    const esperado = Buffer.from(partes[3], "base64");
    if (!isFinite(N) || N < 1024 || !sal.length || !esperado.length) return resolver(false);
    scrypt(password, sal, esperado.length, { N: N, r: SCRYPT.r, p: SCRYPT.p }, function (error, clave) {
      if (error) return resolver(false);
      resolver(clave.length === esperado.length && timingSafeEqual(clave, esperado));
    });
  });
}

async function main() {
  const [correo, nombre, clave] = process.argv.slice(2);
  if (!correo || !nombre || !clave) {
    console.error('Uso: npm run usuario -- "correo@dominio.com" "Nombre" "contraseña"');
    process.exit(1);
  }
  const email = correo.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Ese correo no parece válido.");
    process.exit(1);
  }
  if (clave.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const { conectar } = await import("./conectar.js");
  const { query, cerrar } = await conectar();
  try {
    const hash = await hashPassword(clave);
    const { rows } = await query(
      "insert into usuarios (email, nombre, password_hash, activo) values ($1, $2, $3, true)" +
      " on conflict (email) do update set nombre = $2, password_hash = $3, activo = true" +
      " returning id, email, nombre",
      [email, nombre.trim().slice(0, 120), hash]
    );
    console.log("Usuario listo: " + rows[0].nombre + " <" + rows[0].email + ">");
    console.log("Ya puede entrar desde la pantalla de acceso del cotizador.");
  } catch (error) {
    console.error("No se pudo crear el usuario:", error.message);
    process.exitCode = 1;
  } finally {
    await cerrar();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
