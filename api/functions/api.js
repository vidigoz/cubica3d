/* API del cotizador Cubica3D (función "api" del sitio, servida por Netlify).
 *
 * Una sola función HTTP que reemplaza el `localStorage` compartido del negocio:
 * configuración, cotizaciones enviadas y posiciones del Kanban viven en Postgres.
 * El navegador NUNCA ve la cadena de conexión: sólo habla con esta API.
 *
 *   POST   /api/login                 { email, password }          -> { token, usuario }
 *   GET    /api/pin                                                -> { requerido, digitos }
 *   POST   /api/pin                   { pin }                      -> { ok:true, token, usuario }
 *                                                                       o 401 { error }
 *   POST   /api/acceso                (sin cuerpo)                 -> { automatico:true, token, usuario }
 *                                                                       o { automatico:false, aviso }
 *   POST   /api/logout                                               -> { ok }
 *   GET    /api/bootstrap                                            -> config + tablero + folio
 *   GET    /api/tablero                                              -> sólo las tarjetas
 *   GET    /api/folio                                                -> { siguiente }
 *   PUT    /api/config                { colores, precios }           -> config guardada
 *                                     precios: { nombre, nombreApellido,
 *                                                clicer: { porLetraCorto,
 *                                                          porLetraLargo,
 *                                                          letrasCorte } }
 *   POST   /api/cotizaciones          { clientId, meta, items }      -> tarjeta creada (entra
 *                                                                       ARRIBA de «Cotización»)
 *   PUT    /api/cotizaciones/:id      { meta, items }                -> tarjeta editada: sus líneas y datos
 *                                                                       reemplazados, sin moverla
 *   PATCH  /api/cotizaciones/:id      { columna } o { posicion } o   -> tarjeta movida, con
 *                                     { pagado } o { cliente } o         «Pagado» cambiado, con el
 *                                     { basesListas } o                  cliente corregido, los tildes
 *                                     { teclasListas } (la combinación   del taller puestos o en otro
 *                                     que haga falta)                   lugar (arrastre)
 *   DELETE /api/cotizaciones/:id                                     -> { ok }
 *
 * Orden del tablero: se lee por `columna, posicion, folio` (ver leerTablero). Una
 * cotización NUEVA entra arriba de «Cotización» —es la que se acaba de mandar y hay que
 * verla—; la que llega por un CAMBIO de columna entra ABAJO, así los trabajos viejos
 * quedan arriba y los nuevos abajo. El orden fino lo manda el cliente con `posicion`
 * (arrastrar y soltar): el servidor la valida y la guarda tal cual, porque es el hueco
 * donde soltó la tarjeta.
 *
 * Rutas públicas: /api (saludo), /api/login, /api/pin y /api/acceso. /api/acceso es
 * el camino normal de entrada: la app no tiene pantalla de login (se sacó a
 * propósito), así que al abrirse pregunta por acá y el servidor le abre la sesión
 * con la cuenta del taller, SIN correo ni contraseña. Todo lo demás exige
 * `Authorization: Bearer <token>`: el token sigue siendo obligatorio, lo que no
 * hace falta es escribir nada.
 *
 * ✔ El PIN (variable PIN del .env). Si PIN tiene 4 dígitos, el cotizador queda
 *   cerrado con llave: /api/acceso YA NO entrega sesión —contesta
 *   { automatico:false, pin:true }— y la única entrada es POST /api/pin con los 4
 *   dígitos. La app pregunta GET /api/pin al abrirse, muestra el pinpad y, al
 *   cuarto dígito, verifica sola (no hay botón de entrar): si está bien, el
 *   servidor abre la misma sesión de siempre. Sin PIN —o si la variable no son 4
 *   dígitos— todo funciona como antes, así que apagarlo es borrar la variable.
 *   El PIN es una llave de 4 dígitos: frena a quien abre el enlace, no reemplaza
 *   una contraseña. Los intentos fallidos se cuentan por instancia (5 cada 15
 *   minutos), así que probar los 10.000 números no es gratis.
 *
 * La cuenta del taller es la de ACCESO_EMAIL en el .env (o, si esa no existe, la
 * primera cuenta activa de la base). Se crea o se actualiza con
 *   cd api && npm run acceso
 * que usa ACCESO_NOMBRE / ACCESO_EMAIL / ACCESO_CLAVE: la clave queda en claro
 * SÓLO en tu .env (no se sube) y en Postgres va su hash scrypt —igual que antes—
 * pero ya nadie la escribe: sirve para crear la cuenta. El servidor local la deja
 * lista al arrancar (tools/asegurar-acceso.js), por eso una máquina nueva abre
 * sin configurar nada.
 *
 * Para volver a exigir credenciales: ACCESO_LIBRE="false" (en el .env o en las
 * variables del sitio). Ahí /api/acceso contesta { automatico:false, aviso } y el
 * único camino es POST /api/login con correo y contraseña.
 *
 * El archivo es autocontenido a propósito (sin imports relativos): así lo puede
 * empaquetar cualquier plataforma. El envuelto de cada una vive afuera
 * (netlify/functions/api.mjs) y la cadena de conexión llega por DATABASE_URL.
 * Si tocás el formato del hash de contraseñas, mirá también
 * tools/crear-usuario.js (lo verifica el test).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generar } from "../tools/impresion.js";
import { Pool } from "pg";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";

const COLUMNAS = ["cotizacion", "confirmado", "trabajo", "realizado", "entregado"];   // las cinco del Kanban
const TIPO_MANUAL = "Cotización manual";   // igual que PO.TIPO_MANUAL, en js/po.js
const COLUMNA_ENTREGADO = "entregado";   // al entrar acá el pago se tilda solo (ver PATCH)
const DIAS_SESION = 30;
const INTENTOS_MAX = 10;                                   // por correo...
const INTENTOS_VENTANA_MS = 15 * 60 * 1000;                // ...cada 15 minutos
const SCRYPT = { N: 16384, r: 8, p: 1, largo: 64, sal: 16 };
const LIMITE = { cliente: 120, notas: 600, titulo: 120, tipo: 40, descuentoNota: 200 };
// Cada tarjeta guarda su lugar dentro de la columna con un número (`posicion`, ver
// db/schema.sql). Se separan de a mil y el hueco se parte al medio entre las vecinas: así
// reordenar NUNCA renumera la columna entera, sólo mueve una tarjeta de número.
const PASO_POSICION = 1000;
// Techo de cordura: un cliente modificado no puede inventar una posición absurda.
const POSICION_MAXIMA = 1e12;
const PIN_DIGITOS = 4;                                     // el PIN del taller tiene 4
const INTENTOS_PIN_MAX = 5;                                // 5 intentos cada 15 minutos
const CLAVE_PIN = "#pin";                                  // los cuenta acá (no es un correo)
const AVISO_PIN_ROTO = "El PIN del servidor está mal configurado: tiene que tener " +
  PIN_DIGITOS + " dígitos (variable PIN).";

/* ------------------------------ Contraseñas ------------------------------ */

// scrypt$<N>$<sal base64>$<hash base64>
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

/* ------------------------------- Utilidades ------------------------------- */

const texto = (valor) => (typeof valor === "string" ? valor : valor == null ? "" : String(valor));
const recortar = (valor, largo) => texto(valor).trim().slice(0, largo);
const numero = (valor, porDefecto) => {
  const n = Number(String(valor == null ? "" : valor).replace(",", "."));
  return isFinite(n) ? n : porDefecto;
};
const huella = (token) => createHash("sha256").update(token).digest("hex");
const redondear = (n) => Math.round(n * 100) / 100;

// El PIN se compara por hash (siempre del mismo tamaño) para no delatar ni el
// largo ni la posición del primer dígito que falla.
const mismoPin = (candidato, esperado) =>
  timingSafeEqual(Buffer.from(huella(candidato), "hex"), Buffer.from(huella(esperado), "hex"));

// Como numero(), pero respetando el valor por defecto: si el dato no viene
// (undefined / null / ""), devuelve el de por defecto en vez de 0.
const numeroODefecto = (valor, porDefecto) =>
  (valor == null || String(valor).trim() === "" ? porDefecto : numero(valor, porDefecto));

// La posición que manda el cliente al arrastrar una tarjeta (PATCH): tiene que ser un
// NÚMERO de verdad —no un texto, ni infinito, ni una barbaridad—; si no sirve, null y
// la ruta contesta 400. Se exige número (y no "algo que se pueda convertir") a propósito:
// el punto medio entre dos vecinas se calcula en el navegador y llega como número.
const posicionValida = (valor) =>
  (typeof valor === "number" && isFinite(valor) && Math.abs(valor) <= POSICION_MAXIMA)
    ? valor
    : null;

// Lo que la gente escribe en el .env para decir "sí": true / 1 / si / on / yes.
const esVerdadero = (valor) => valor === true ||
  ["1", "true", "si", "sí", "on", "yes", "verdadero"].includes(texto(valor).trim().toLowerCase());

// «AAAA-MM-DD» que existe en el calendario.
function fechaValida(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(valor));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

async function leerJson(request) {
  try {
    return JSON.parse(await request.text());
  } catch {
    return null;
  }
}

/* --------------------------- Saneo de la entrada --------------------------- */

// Las mismas reglas que usa el frontend (js/proceso.js), para que un cliente
// viejo o modificado no pueda guardar basura ni inflar totales.
// El descuento que manda el cliente, en pesos: nunca negativo y nunca mayor que el
// subtotal (la cotización no puede quedar en negativo). Sin número, 0.
function descuentoValido(valor, subtotal) {
  const n = redondear(numero(valor, 0));
  return Math.min(Math.max(0, n), Math.max(0, subtotal));
}

function itemsValidos(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((it) => it && texto(it.titulo).trim())
    .map((it, indice) => ({
      orden: indice,
      tipo: recortar(it.tipo || "Producto", LIMITE.tipo),
      titulo: recortar(it.titulo, LIMITE.titulo),
      precio: Math.max(0, redondear(numero(it.precio, 0))),
      cantidad: Math.max(1, Math.floor(numero(it.cantidad, 1))),
      detalles: (Array.isArray(it.detalles) ? it.detalles : []).map((d) => ({
        label: recortar((d || {}).label, 60),
        nombre: recortar((d || {}).nombre, 120),
        hex: recortar((d || {}).hex, 20)
      }))
    }));
}

function coloresValidos(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((c) => c && /^#[0-9a-fA-F]{6}$/.test(texto(c.hex)))
    .map((c) => ({
      id: recortar(c.id, 80) || "color-" + Math.random().toString(36).slice(2, 10),
      nombre: recortar(c.nombre, 80) || "Sin nombre",
      hex: texto(c.hex)
    }));
}

// Precios del Clicker de Nombre: es un producto de nombre por letras (cada letra
// lleva base, tecla y letra), así que se cobra POR LETRA en dos tramos —el corto
// hasta `letrasCorte` letras y el largo de ahí en adelante—.
// Si una base vieja todavía no los tiene, se guardan los valores por defecto
// (los mismos que js/clicer.js): así el producto nunca cotiza en cero por
// faltar el dato.
const CLICER_POR_DEFECTO = { porLetraCorto: 15, porLetraLargo: 30, letrasCorte: 5 };
const CHARM_PRECIO_POR_DEFECTO = 350;   // el Charm para Silla cuesta lo mismo lleve lo que lleve

function preciosValidos(precios) {
  const p = precios || {};
  const c = p.clicer || {};
  const ch = p.charm || {};
  return {
    nombre: numero(p.nombre, 0),
    nombreApellido: numero(p.nombreApellido, 0),
    clicer: {
      porLetraCorto: Math.max(0, redondear(numeroODefecto(c.porLetraCorto, CLICER_POR_DEFECTO.porLetraCorto))),
      porLetraLargo: Math.max(0, redondear(numeroODefecto(c.porLetraLargo, CLICER_POR_DEFECTO.porLetraLargo))),
      letrasCorte: Math.max(1, Math.floor(numeroODefecto(c.letrasCorte, CLICER_POR_DEFECTO.letrasCorte)))
    },
    charm: {
      precio: Math.max(0, redondear(numeroODefecto(ch.precio, CHARM_PRECIO_POR_DEFECTO)))
    }
  };
}

/* ------------------------------ La aplicación ------------------------------ */
// `query(sql, params)` es lo único que toca la base de datos, así que el test
// puede inyectar una versión falsa y probar rutas, permisos y saneo sin Postgres.
export function crearApp(opciones) {
  const query = opciones.query;
  const permitidos = String(opciones.origenPermitido || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const ahora = opciones.ahora || (() => new Date());
  const log = opciones.log || ((...args) => console.error(...args));
  const intentos = new Map();   // correo -> { n, hasta } (por instancia)

  // Entrada de la app (ver el encabezado): viene del .env y se lee una sola vez al
  // crear la app, y por eso el test puede inyectarla. Manda ACCESO_LIBRE y, como
  // alias, el viejo ACCESO_AUTOMATICO; sin ninguno de los dos, entra (es lo que
  // quiere el taller: la app se abre y ya).
  const acceso = opciones.acceso || {};
  const accesoLibreCrudo = texto(acceso.libre).trim() || texto(acceso.automatico).trim();
  const accesoLibre = !accesoLibreCrudo || esVerdadero(accesoLibreCrudo);
  const accesoEmail = texto(acceso.email).trim().toLowerCase();

  // PIN del taller (ver el encabezado): se lee acá una sola vez, igual que el
  // acceso, y por eso el test puede inyectarlo. Sólo vale si son 4 dígitos: si la
  // variable tiene otra cosa, el cotizador queda cerrado con un aviso que dice qué
  // arreglar (mejor eso que abrirlo en silencio creyendo que está protegido).
  const pinCrudo = texto(opciones.pin).trim();
  const pin = new RegExp("^[0-9]{" + PIN_DIGITOS + "}$").test(pinCrudo) ? pinCrudo : "";
  const pinRoto = !pin && !!pinCrudo;

  function cors(request) {
    const origen = request.headers.get("Origin") || "";
    let permitir = "";
    if (!permitidos.length) permitir = origen || "*";              // sin lista: se refleja
    else if (origen && permitidos.includes(origen)) permitir = origen;
    else if (!origen) permitir = permitidos[0];                    // curl / herramientas
    if (!permitir) return null;
    return {
      "Access-Control-Allow-Origin": permitir,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin"
    };
  }

  const responder = (cuerpo, estado, cabeceras) =>
    new Response(JSON.stringify(cuerpo), {
      status: estado || 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cabeceras }
    });
  const ok = (cuerpo, cabeceras) => responder(cuerpo || { ok: true }, 200, cabeceras);
  const fallo = (mensaje, estado, cabeceras) => responder({ error: mensaje }, estado || 400, cabeceras);

  function permitirIntento(clave, maximo) {
    const t = ahora().getTime();
    const registro = intentos.get(clave);
    if (!registro || t > registro.hasta) {
      if (intentos.size > 5000) intentos.clear();   // techo de memoria
      intentos.set(clave, { n: 1, hasta: t + INTENTOS_VENTANA_MS });
      return true;
    }
    registro.n += 1;
    return registro.n <= (maximo || INTENTOS_MAX);
  }

  /* --------------------------------- Sesión -------------------------------- */

  async function usuarioDe(request) {
    const cabecera = request.headers.get("Authorization") || "";
    const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7).trim() : "";
    if (!token) return null;
    const { rows } = await query(
      "select u.id, u.nombre, u.email from sesiones s" +
      " join usuarios u on u.id = s.usuario_id" +
      " where s.token_hash = $1 and s.expira > now() and u.activo",
      [huella(token)]
    );
    return rows[0] || null;
  }

  /* --------------------------- Lectura de la base --------------------------- */

  async function leerConfig() {
    const { rows } = await query(
      "select colores, precios, actualizada, actualizada_por from configuracion where id = 'default'"
    );
    const fila = rows[0];
    if (!fila) return { config: { colores: [], precios: preciosValidos(null) }, configUsuario: "" };
    return {
      config: {
        colores: Array.isArray(fila.colores) ? fila.colores : [],
        precios: preciosValidos(fila.precios)
      },
      configUsuario: fila.actualizada_por || "",
      configActualizada: new Date(fila.actualizada).toISOString()
    };
  }

  function aItem(fila) {
    return {
      id: fila.orden + ":" + fila.titulo,
      tipo: fila.tipo,
      titulo: fila.titulo,
      detalles: Array.isArray(fila.detalles) ? fila.detalles : [],
      precio: Number(fila.precio),
      cantidad: Number(fila.cantidad)
    };
  }

  function aTarjeta(fila, items) {
    return {
      id: fila.id,
      folio: Number(fila.folio),
      fecha: fila.fecha,
      cliente: fila.cliente,
      notas: fila.notas,
      items: items || [],
      unidades: Number(fila.unidades),
      descuento: Number(fila.descuento || 0),
      descuentoNota: fila.descuento_nota || "",
      total: Number(fila.total),
      columna: fila.columna,
      posicion: Number(fila.posicion),
      pagado: !!fila.pagado,
      fechaPago: fila.pagado ? (fila.fecha_pago || null) : null,
      // Los tildes del taller: qué tandas del desglose ya están hechas (las bases
      // del clicker y las teclas con su letra). No salen en la hoja ni en el PDF:
      // son del tablero, para saber qué falta imprimir.
      basesListas: !!fila.bases_listas,
      teclasListas: !!fila.teclas_listas,
      creada: new Date(fila.creada).toISOString(),
      movida: new Date(fila.movida).toISOString(),
      creadaPor: fila.creada_por || "",
      movidaPor: fila.movida_por || ""
    };
  }

  // Devuelve el tablero completo (sin borradas). Son pocas tarjetas activas:
  // traerlas enteras una vez cada 15 s es más simple y más seguro que sincronizar
  // por diferencias, y evita que dos navegadores queden desfasados.
  async function leerTablero() {
    const { rows } = await query(
      "select id, folio, to_char(fecha, 'YYYY-MM-DD') as fecha, cliente, notas, columna," +
      " posicion, unidades, descuento, descuento_nota, total, pagado, to_char(fecha_pago, 'YYYY-MM-DD') as fecha_pago, bases_listas, teclas_listas," +
      " creada, movida, creada_por, movida_por" +
      " from cotizaciones where borrada_en is null" +
      " order by columna, posicion, folio"
    );
    const { rows: items } = await query(
      "select cotizacion_id, orden, tipo, titulo, precio, cantidad, detalles" +
      " from cotizacion_items" +
      " where cotizacion_id in (select id from cotizaciones where borrada_en is null)" +
      " order by orden"
    );

    const porCotizacion = new Map();
    items.forEach((it) => {
      const lista = porCotizacion.get(it.cotizacion_id) || [];
      lista.push(aItem(it));
      porCotizacion.set(it.cotizacion_id, lista);
    });

    let actualizado = "";
    const cotizaciones = rows.map((fila) => {
      const tarjeta = aTarjeta(fila, porCotizacion.get(fila.id) || []);
      if (tarjeta.movida > actualizado) actualizado = tarjeta.movida;
      return tarjeta;
    });

    return { cotizaciones: cotizaciones, actualizado: actualizado };
  }

  async function leerFolio() {
    const { rows } = await query("select ultimo + 1 as siguiente from folios where id = 'default'");
    return Number((rows[0] || {}).siguiente || 1);
  }

  async function leerTarjeta(id) {
    const { rows } = await query(
      "select id, folio, to_char(fecha, 'YYYY-MM-DD') as fecha, cliente, notas, columna," +
      " posicion, unidades, descuento, descuento_nota, total, pagado, to_char(fecha_pago, 'YYYY-MM-DD') as fecha_pago, bases_listas, teclas_listas," +
      " creada, movida, creada_por, movida_por" +
      " from cotizaciones where id = $1", [id]
    );
    if (!rows[0]) return null;
    const { rows: items } = await query(
      "select cotizacion_id, orden, tipo, titulo, precio, cantidad, detalles" +
      " from cotizacion_items where cotizacion_id = $1 order by orden", [id]
    );
    return aTarjeta(rows[0], items.map(aItem));
  }

  /* ------------------------------ Manejadores ------------------------------ */

  async function login(request, contexto) {
    const cuerpo = await leerJson(request);
    if (!cuerpo) return fallo("Cuerpo JSON inválido", 400, contexto.cabeceras);

    const email = texto(cuerpo.email).trim().toLowerCase();
    const password = texto(cuerpo.password);
    if (!email || !password) return fallo("Faltan el correo o la contraseña.", 400, contexto.cabeceras);
    if (!permitirIntento(email)) return fallo("Demasiados intentos. Probá de nuevo en unos minutos.", 429, contexto.cabeceras);

    const { rows } = await query(
      "select id, nombre, email, password_hash, activo from usuarios where email = $1", [email]
    );
    const usuario = rows[0];
    // Mismo mensaje si el correo no existe o si la clave está mal: no damos pistas.
    if (!usuario || !usuario.activo) return fallo("Correo o contraseña incorrectos.", 401, contexto.cabeceras);
    if (!(await verificarPassword(password, usuario.password_hash))) {
      return fallo("Correo o contraseña incorrectos.", 401, contexto.cabeceras);
    }

    intentos.delete(email);
    return ok(await abrirSesion(usuario), contexto.cabeceras);
  }

  // Abre la sesión de un usuario YA verificado. Lo comparten el login normal y el
  // acceso automático: se genera un token al azar (en la base queda sólo su
  // SHA-256) que dura DIAS_SESION días.
  async function abrirSesion(usuario) {
    await query("delete from sesiones where expira < now()");   // limpieza barata
    const token = randomBytes(32).toString("base64url");
    await query(
      "insert into sesiones (token_hash, usuario_id, expira)" +
      " values ($1, $2, now() + make_interval(days => $3::int))",
      [huella(token), usuario.id, DIAS_SESION]
    );
    return {
      token: token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email },
      diasSesion: DIAS_SESION
    };
  }

  // Con qué cuenta entra la app: la de ACCESO_EMAIL si existe y está activa; si no
  // (o si esa cuenta no está), la primera cuenta activa de la base — así una
  // instalación nueva abre igual, sin tocar el .env.
  async function cuentaDeAcceso() {
    if (accesoEmail) {
      const { rows } = await query(
        "select id, nombre, email from usuarios where email = $1 and activo", [accesoEmail]
      );
      if (rows[0]) return rows[0];
    }
    const { rows } = await query(
      "select id, nombre, email from usuarios where activo order by creado limit 1"
    );
    return rows[0] || null;
  }

  /* ---------------------------------- PIN ---------------------------------- */

  // ¿Este servidor pide PIN? La app lo pregunta al abrirse para saber si muestra
  // el pinpad o entra sola. Es pública a propósito: no dice nada más que eso.
  function estadoPin(request, contexto) {
    return ok({
      requerido: !!pin || pinRoto,
      digitos: PIN_DIGITOS,
      aviso: pinRoto ? AVISO_PIN_ROTO : ""
    }, contexto.cabeceras);
  }

  // Entrada con PIN: la app manda los 4 dígitos y, si están bien, acá se abre la
  // misma sesión de siempre. El PIN vive en el .env del servidor: el navegador no
  // lo compara ni lo guarda, sólo lo manda una vez (lo que queda guardado es el
  // token, igual que con cualquier otra entrada).
  async function verificarPin(request, contexto) {
    if (pinRoto) {
      log("[api] " + AVISO_PIN_ROTO);
      return fallo(AVISO_PIN_ROTO, 500, contexto.cabeceras);
    }
    if (!pin) return fallo("Este servidor no pide PIN.", 400, contexto.cabeceras);

    const cuerpo = await leerJson(request);
    if (!cuerpo) return fallo("Cuerpo JSON inválido", 400, contexto.cabeceras);
    if (!permitirIntento(CLAVE_PIN, INTENTOS_PIN_MAX)) {
      return fallo("Demasiados intentos. Probá de nuevo en unos minutos.", 429, contexto.cabeceras);
    }
    if (!mismoPin(texto(cuerpo.pin).trim(), pin)) {
      return fallo("PIN incorrecto.", 401, contexto.cabeceras);
    }

    intentos.delete(CLAVE_PIN);
    const usuario = await cuentaDeAcceso();
    if (!usuario) {
      log("[api] la base no tiene ninguna cuenta activa: corré «npm run acceso» en api/");
      return fallo("La base no tiene ninguna cuenta activa: corré «npm run acceso» en api/.",
        500, contexto.cabeceras);
    }
    return ok(Object.assign({ ok: true }, await abrirSesion(usuario)), contexto.cabeceras);
  }

  // La app pide la sesión por acá al abrirse: el servidor la abre sola con la
  // cuenta del taller, sin correo ni contraseña. No hay pantalla de login (se sacó
  // a propósito): si esto no puede entrar, el frontend muestra el motivo y un
  // botón para reintentar, y la única salida es arreglar lo que dice el aviso.
  async function accesoAutomatico(request, contexto) {
    // Con PIN puesto, por acá no se entra: hay que mandar los 4 dígitos a
    // POST /api/pin. Se avisa igual (y con 200) para que la app —incluso una
    // versión vieja en caché— sepa que lo que corresponde es el pinpad.
    if (pin || pinRoto) {
      return ok({
        automatico: false,
        pin: true,
        aviso: pinRoto
          ? AVISO_PIN_ROTO
          : "El cotizador está protegido con PIN: entrá por POST /api/pin."
      }, contexto.cabeceras);
    }

    if (!accesoLibre) {
      return ok({
        automatico: false,
        aviso: "El servidor pide correo y contraseña (ACCESO_LIBRE): entrá por POST /api/login."
      }, contexto.cabeceras);
    }

    const usuario = await cuentaDeAcceso();
    if (!usuario) {
      log("[api] la base no tiene ninguna cuenta activa: corré «npm run acceso» en api/");
      return ok({
        automatico: false,
        aviso: "La base no tiene ninguna cuenta activa: corré «npm run acceso» en api/."
      }, contexto.cabeceras);
    }

    return ok(Object.assign({ automatico: true }, await abrirSesion(usuario)), contexto.cabeceras);
  }

  async function logout(request, contexto) {
    const cabecera = request.headers.get("Authorization") || "";
    const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7).trim() : "";
    if (token) await query("delete from sesiones where token_hash = $1", [huella(token)]);
    return ok({ ok: true }, contexto.cabeceras);
  }

  async function bootstrap(request, contexto) {
    const config = await leerConfig();
    const tablero = await leerTablero();
    return ok({
      usuario: contexto.usuario,
      config: config.config,
      configUsuario: config.configUsuario,
      configActualizada: config.configActualizada,
      cotizaciones: tablero.cotizaciones,
      actualizado: tablero.actualizado,
      folioSiguiente: await leerFolio(),
      servidorHora: ahora().toISOString()
    }, contexto.cabeceras);
  }

  async function tablero(request, contexto) {
    const datos = await leerTablero();
    return ok({
      cotizaciones: datos.cotizaciones,
      actualizado: datos.actualizado,
      servidorHora: ahora().toISOString()
    }, contexto.cabeceras);
  }

  async function folio(request, contexto) {
    return ok({ siguiente: await leerFolio() }, contexto.cabeceras);
  }

  async function guardarConfig(request, contexto) {
    const cuerpo = await leerJson(request);
    if (!cuerpo) return fallo("Cuerpo JSON inválido", 400, contexto.cabeceras);
    if (!Array.isArray(cuerpo.colores)) return fallo("Falta la lista de colores.", 400, contexto.cabeceras);

    const colores = coloresValidos(cuerpo.colores);
    const precios = preciosValidos(cuerpo.precios);
    await query(
      "insert into configuracion (id, colores, precios, actualizada, actualizada_por)" +
      " values ('default', $1::jsonb, $2::jsonb, now(), $3)" +
      " on conflict (id) do update set colores = $1::jsonb, precios = $2::jsonb," +
      " actualizada = now(), actualizada_por = $3",
      [JSON.stringify(colores), JSON.stringify(precios), contexto.usuario.nombre]
    );
    return ok({ config: { colores: colores, precios: precios }, configUsuario: contexto.usuario.nombre }, contexto.cabeceras);
  }

  // La cotización nueva entra ARRIBA de «Cotización» (el `min - PASO` de la CTE): es la
  // que se acaba de mandar y hay que verla sí o sí. Lo que llega por un CAMBIO de columna
  // entra ABAJO (ver posicionAbajoDe), y el arrastre manda la posición exacta.
  const SQL_NUEVA = `
    with posicion as (
      select coalesce(min(posicion), ${PASO_POSICION}) - ${PASO_POSICION} as p
        from cotizaciones where columna = 'cotizacion' and borrada_en is null
    ), nueva as (
      insert into cotizaciones (client_id, folio, fecha, cliente, notas, columna, posicion,
                                unidades, total, creada_por, movida_por, descuento, descuento_nota)
      select $1::text, siguiente_folio(), coalesce($2::date, current_date), $3, $4,
             'cotizacion', p.p, $5::int, $6::numeric, $7, $7, $9::numeric, $10
        from posicion p
      returning *
    ), lineas as (
      insert into cotizacion_items (cotizacion_id, orden, tipo, titulo, precio, cantidad, detalles)
      select n.id, i.orden, i.tipo, i.titulo, i.precio, i.cantidad, i.detalles
        from nueva n,
             jsonb_to_recordset($8::jsonb) as i(orden int, tipo text, titulo text,
                                                precio numeric, cantidad int, detalles jsonb)
      returning 1
    ), bitacora as (
      insert into movimientos (cotizacion_id, de_columna, a_columna, usuario)
      select n.id, null, n.columna, $7 from nueva n
      returning 1
    )
    select n.id from nueva n`;

  // Guarda la cotización como copia congelada. Todo (folio, líneas y bitácora)
  // ocurre en UN solo viaje atómico: no puede quedar una tarjeta sin productos.
  async function crearCotizacion(request, contexto) {
    const cuerpo = await leerJson(request);
    if (!cuerpo) return fallo("Cuerpo JSON inválido", 400, contexto.cabeceras);

    const meta = cuerpo.meta || {};
    const items = itemsValidos(cuerpo.items);
    if (!items.length) return fallo("La cotización no tiene productos que guardar.", 400, contexto.cabeceras);

    const clientId = recortar(cuerpo.clientId, 80) || null;
    if (clientId) {
      // Si ya entró (reintento de red, doble clic), devolvemos la misma tarjeta.
      const { rows } = await query("select id from cotizaciones where client_id = $1", [clientId]);
      if (rows[0]) {
        return ok({ cotizacion: await leerTarjeta(rows[0].id), repetida: true }, contexto.cabeceras);
      }
    }

    const unidades = items.reduce((suma, it) => suma + it.cantidad, 0);
    const subtotal = redondear(items.reduce((suma, it) => suma + it.precio * it.cantidad, 0));
    const descuento = descuentoValido(meta.descuento, subtotal);
    const parametros = [
      clientId,
      texto(meta.fecha) || null,
      recortar(meta.cliente, LIMITE.cliente),
      recortar(meta.notas, LIMITE.notas),
      unidades,
      redondear(subtotal - descuento),
      contexto.usuario.nombre,
      JSON.stringify(items),
      descuento,
      descuento ? recortar(meta.descuentoNota, LIMITE.descuentoNota) : ""
    ];

    let idNuevo;
    try {
      const { rows } = await query(SQL_NUEVA, parametros);
      idNuevo = rows[0].id;
    } catch (error) {
      // 23505 = violación de unicidad: dos envíos del mismo clientId a la vez.
      if (error && error.code === "23505" && clientId) {
        const { rows } = await query("select id from cotizaciones where client_id = $1", [clientId]);
        if (rows[0]) return ok({ cotizacion: await leerTarjeta(rows[0].id), repetida: true }, contexto.cabeceras);
      }
      throw error;
    }

    const tarjeta = await leerTarjeta(idNuevo);
    const pedido = parseInt(meta.folio, 10);
    return ok({
      cotizacion: tarjeta,
      // true cuando el folio que traía el formulario ya no estaba libre: el
      // servidor asignó otro y la pantalla debe avisar en vez de mentir.
      folioReasignado: isFinite(pedido) && pedido > 0 && pedido !== tarjeta.folio,
      folioSiguiente: await leerFolio()
    }, contexto.cabeceras);
  }

  // Reemplaza las líneas y los datos de una tarjeta que ya está en el tablero:
  // es «editar la cotización» (agregar o quitar productos, cambiar cantidades o
  // precios, corregir fecha, cliente y notas). La tarjeta NO se mueve: conserva su
  // folio, su columna, su lugar y su pago. Todo ocurre en UN solo viaje atómico
  // (datos, borrado de las líneas viejas y las nuevas), como al crearla.
  // Los tildes del taller (bases y teclas hechas) hablan de lo que se fabricó: si
  // cambió algo de lo que se fabrica —cualquier línea que no sea una cotización
  // manual, que es sólo texto y precio— ya no valen y se destildan. Cambiar sólo
  // precios, notas, cliente o fecha los respeta.
  const SQL_EDITAR = `
    with editada as (
      update cotizaciones
         set fecha = coalesce($2::date, fecha), cliente = $3, notas = $4,
             unidades = $5::int, total = $6::numeric,
             bases_listas = $7, teclas_listas = $8,
             movida = now(), movida_por = $9,
             descuento = $11::numeric, descuento_nota = $12
       where id = $1 and borrada_en is null
      returning id
    ), viejas as (
      delete from cotizacion_items where cotizacion_id in (select id from editada)
      returning 1
    ), lineas as (
      insert into cotizacion_items (cotizacion_id, orden, tipo, titulo, precio, cantidad, detalles)
      select e.id, i.orden, i.tipo, i.titulo, i.precio, i.cantidad, i.detalles
        from editada e,
             jsonb_to_recordset($10::jsonb) as i(orden int, tipo text, titulo text,
                                                 precio numeric, cantidad int, detalles jsonb)
      returning 1
    )
    select id from editada`;

  // Lo que se fabrica de una línea (sin el precio): para saber si la edición
  // cambió algo que el taller ya había tildado.
  function huellaDeFabricacion(items) {
    return JSON.stringify(items
      .filter((it) => it.tipo !== TIPO_MANUAL)
      .map((it) => [it.tipo, it.titulo, it.cantidad,
        // Se arma clave por clave: el jsonb de la base no guarda el orden de las claves.
        (it.detalles || []).map((d) => [d.label, d.nombre, d.hex])]));
  }

  async function editarCotizacion(request, contexto) {
    const cuerpo = await leerJson(request);
    if (!cuerpo) return fallo("Cuerpo JSON inválido", 400, contexto.cabeceras);

    const meta = cuerpo.meta || {};
    const items = itemsValidos(cuerpo.items);
    if (!items.length) return fallo("La cotización no puede quedar sin productos.", 400, contexto.cabeceras);

    const actual = await leerTarjeta(contexto.params.id);
    if (!actual) return fallo("Esa cotización ya no está en el tablero.", 404, contexto.cabeceras);

    const cambioLoFabricado = huellaDeFabricacion(items) !== huellaDeFabricacion(actual.items);
    const unidades = items.reduce((suma, it) => suma + it.cantidad, 0);
    const subtotal = redondear(items.reduce((suma, it) => suma + it.precio * it.cantidad, 0));
    const descuento = descuentoValido(meta.descuento, subtotal);
    const total = redondear(subtotal - descuento);

    const { rows } = await query(SQL_EDITAR, [
      contexto.params.id,
      texto(meta.fecha) || null,
      recortar(meta.cliente, LIMITE.cliente),
      recortar(meta.notas, LIMITE.notas),
      unidades,
      total,
      cambioLoFabricado ? false : !!actual.basesListas,
      cambioLoFabricado ? false : !!actual.teclasListas,
      contexto.usuario.nombre,
      JSON.stringify(items),
      descuento,
      descuento ? recortar(meta.descuentoNota, LIMITE.descuentoNota) : ""
    ]);
    if (!rows[0]) return fallo("Esa cotización ya no está en el tablero.", 404, contexto.cabeceras);
    return ok({ cotizacion: await leerTarjeta(contexto.params.id) }, contexto.cabeceras);
  }

  // Posición para entrar ABAJO de una columna: detrás de la última tarjeta. Se separan
  // de a PASO_POSICION para que entre dos vecinas siempre quede lugar (lo que usa el
  // arrastre: el punto medio del hueco). Una columna vacía arranca en 1000.
  async function posicionAbajoDe(columna, id) {
    const { rows } = await query(
      "select coalesce(max(posicion), 0) + " + PASO_POSICION + " as p from cotizaciones" +
      " where columna = $1 and borrada_en is null and id <> $2",
      [columna, id]
    );
    return Number(rows[0].p);
  }

  // Posición para entrar ARRIBA de una columna: delante de la primera tarjeta, un paso
  // más chica que la menor (puede ser negativa, no importa: sólo ordena). Es la que usa
  // «Entregado»: lo último que se entregó queda hasta arriba y empuja lo demás hacia abajo.
  async function posicionArribaDe(columna, id) {
    const { rows } = await query(
      "select coalesce(min(posicion), " + PASO_POSICION + ") - " + PASO_POSICION + " as p from cotizaciones" +
      " where columna = $1 and borrada_en is null and id <> $2",
      [columna, id]
    );
    return Number(rows[0].p);
  }

  // Mueve la tarjeta de columna, la reordena dentro de su columna, cambia «Pagado»,
  // corrige el nombre del cliente y/o tilda lo que el taller ya hizo. El cuerpo lleva
  // `columna`, `posicion`, `pagado`, `cliente`, `basesListas`, `teclasListas` o la
  // combinación que haga falta (mover y tildar suelen ir juntos: ES UNA SOLA
  // LLAMADA). Entrar a
  // «Entregado» tilda el pago solo —es lo que hace el taller al entregar— salvo
  // que el cliente diga lo contrario (`pagado: false`), y destildarlo después es
  // un clic: a veces se entrega y se cobra más tarde.
  // El nombre también se corrige por acá, sin mover la tarjeta: es para arreglar
  // un dedazo del carrito («Mria López») sin borrar y volver a enviar la
  // cotización, que ya es una copia congelada. Como el tilde, no gasta bitácora
  // (ver el `else` de abajo).
  // Los tildes del taller (`basesListas` y `teclasListas`) son lo mismo: qué tandas
  // del desglose de la tarjeta ya se imprimieron. Se tildan desde la propia tarjeta
  // sin moverla ni ensuciar la bitácora, y viajan con ella para que el resto del
  // equipo vea qué falta imprimir (ninguno de los dos sale en la hoja ni en el PDF).
  // Y el ORDEN dentro de la columna también se cambia por acá:
  //  · mandando `posicion` —lo que hace arrastrar y soltar— manda el cliente: es el
  //    hueco donde soltó la tarjeta (el navegador calcula el punto medio entre las
  //    vecinas, así no hay que renumerar nada);
  //  · sin `posicion`, la tarjeta que llega a otra columna entra ABAJO, para que los
  //    trabajos viejos queden arriba y los nuevos abajo; la que llega a «Entregado» entra
  //    ARRIBA (la última entrega es la primera de la lista).
  // Reordenar sin cambiar de columna no gasta bitácora (no hubo movimiento de
  // columna), igual que los tildes y el nombre: queda el sello de quién y cuándo.
  // Todo lo que se cambie acá mueve `movida`, que es el sello con el que los demás
  // navegadores se enteran de que hay algo nuevo (ver leerTablero).
  async function moverCotizacion(request, contexto) {
    const cuerpo = (await leerJson(request)) || {};
    const columna = texto(cuerpo.columna).trim();
    const pideColumna = !!columna;
    const pidePosicion = Object.prototype.hasOwnProperty.call(cuerpo, "posicion");
    const pidePagado = Object.prototype.hasOwnProperty.call(cuerpo, "pagado");
    const pideFecha = Object.prototype.hasOwnProperty.call(cuerpo, "fechaPago");
    const pideCliente = Object.prototype.hasOwnProperty.call(cuerpo, "cliente");
    const pideBases = Object.prototype.hasOwnProperty.call(cuerpo, "basesListas");
    const pideTeclas = Object.prototype.hasOwnProperty.call(cuerpo, "teclasListas");
    const posicion = pidePosicion ? posicionValida(cuerpo.posicion) : null;
    if (pideColumna && COLUMNAS.indexOf(columna) < 0) {
      return fallo("Columna inválida.", 400, contexto.cabeceras);
    }
    if (pidePosicion && posicion === null) {
      return fallo("«posicion» tiene que ser un número.", 400, contexto.cabeceras);
    }
    if (pideFecha && !fechaValida(cuerpo.fechaPago)) {
      return fallo("«fechaPago» tiene que ser una fecha AAAA-MM-DD.", 400, contexto.cabeceras);
    }
    if (!pideColumna && !pidePosicion && !pidePagado && !pideFecha && !pideCliente && !pideBases && !pideTeclas) {
      return fallo("No hay nada que cambiar.", 400, contexto.cabeceras);
    }
    if (pidePagado && typeof cuerpo.pagado !== "boolean") {
      return fallo("«pagado» tiene que ser true o false.", 400, contexto.cabeceras);
    }
    if (pideCliente && typeof cuerpo.cliente !== "string") {
      return fallo("«cliente» tiene que ser texto.", 400, contexto.cabeceras);
    }
    if (pideBases && typeof cuerpo.basesListas !== "boolean") {
      return fallo("«basesListas» tiene que ser true o false.", 400, contexto.cabeceras);
    }
    if (pideTeclas && typeof cuerpo.teclasListas !== "boolean") {
      return fallo("«teclasListas» tiene que ser true o false.", 400, contexto.cabeceras);
    }

    const { rows } = await query(
      "select columna, posicion, pagado, cliente, bases_listas, teclas_listas," +
      " to_char(fecha_pago, 'YYYY-MM-DD') as fecha_pago" +
      " from cotizaciones where id = $1 and borrada_en is null",
      [contexto.params.id]
    );
    const actual = rows[0];
    if (!actual) return fallo("Esa cotización ya no está en el tablero.", 404, contexto.cabeceras);

    // El nombre se limpia igual que al crear la tarjeta (recortar = sin espacios de
    // sobra y con tope de largo). Si no viene en el cuerpo, se deja el que ya estaba.
    const cliente = pideCliente ? recortar(cuerpo.cliente, LIMITE.cliente) : actual.cliente;
    const renombra = pideCliente && cliente !== actual.cliente;

    const mueve = pideColumna && actual.columna !== columna;
    const reordena = pidePosicion && posicion !== Number(actual.posicion);
    const pagado = pidePagado
      ? cuerpo.pagado
      : (mueve && columna === COLUMNA_ENTREGADO ? true : !!actual.pagado);
    const tilda = pagado !== !!actual.pagado;
    // Los tildes del taller, igual: si no vienen en el cuerpo se deja lo que ya había.
    const basesListas = pideBases ? cuerpo.basesListas : !!actual.bases_listas;
    const teclasListas = pideTeclas ? cuerpo.teclasListas : !!actual.teclas_listas;
    const tildaLotes = basesListas !== !!actual.bases_listas || teclasListas !== !!actual.teclas_listas;
    if (pideFecha && !pagado) {
      return fallo("Sólo una cotización pagada tiene fecha de pago.", 400, contexto.cabeceras);
    }
    // El día del pago: al tildar toma el que mande el navegador (o hoy, hora de México);
    // al destildar se borra; una cotización que llega a pagada sin fecha también la toma.
    const cambiaFecha = pagado && (pideFecha ? cuerpo.fechaPago !== actual.fecha_pago : !actual.fecha_pago);
    if (!mueve && !reordena && !tilda && !renombra && !tildaLotes && !cambiaFecha) {
      return ok({ cotizacion: await leerTarjeta(contexto.params.id), sinCambios: true }, contexto.cabeceras);
    }

    if (mueve) {
      // La tarjeta que llega a una columna entra ABAJO —los trabajos viejos quedan
      // arriba y los nuevos abajo— salvo que venga con `posicion`: ahí manda el hueco
      // donde la soltaron al arrastrarla.
      // Todas entran ABAJO, salvo «Entregado»: ahí la que acaba de entregarse va PRIMERA.
      const destino = posicion !== null
        ? posicion
        : (columna === COLUMNA_ENTREGADO
          ? await posicionArribaDe(columna, contexto.params.id)
          : await posicionAbajoDe(columna, contexto.params.id));
      await query(
        "update cotizaciones set columna = $2, posicion = $3, pagado = $4, cliente = $5," +
        " bases_listas = $6, teclas_listas = $7, movida = now(), movida_por = $8 where id = $1",
        [contexto.params.id, columna, destino, pagado, cliente, basesListas, teclasListas,
          contexto.usuario.nombre]
      );
      await query(
        "insert into movimientos (cotizacion_id, de_columna, a_columna, usuario) values ($1, $2, $3, $4)",
        [contexto.params.id, actual.columna, columna, contexto.usuario.nombre]
      );
    } else if (reordena) {
      // Arrastrarla dentro de la misma columna cambia el lugar y nada más: sin
      // bitácora (no hubo cambio de columna) pero con el sello de quién y cuándo.
      await query(
        "update cotizaciones set posicion = $2, pagado = $3, cliente = $4, bases_listas = $5," +
        " teclas_listas = $6, movida = now(), movida_por = $7 where id = $1",
        [contexto.params.id, posicion, pagado, cliente, basesListas, teclasListas,
          contexto.usuario.nombre]
      );
    } else {
      // Sin movimiento de columna ni de lugar no hay nada que anotar en la bitácora:
      // los tildes sueltos y la corrección del nombre quedan en el sello de quién lo
      // hizo y cuándo (que es lo que avisa a los demás navegadores).
      await query(
        "update cotizaciones set pagado = $2, cliente = $3, bases_listas = $4, teclas_listas = $5," +
        " movida = now(), movida_por = $6 where id = $1",
        [contexto.params.id, pagado, cliente, basesListas, teclasListas, contexto.usuario.nombre]
      );
    }
    if (tilda || cambiaFecha) {
      await query(
        "update cotizaciones set fecha_pago = case when $2::boolean then" +
        " coalesce($3::date, fecha_pago, (now() at time zone 'America/Mexico_City')::date)" +
        " else null end where id = $1",
        [contexto.params.id, pagado, pideFecha ? cuerpo.fechaPago : null]
      );
    }
    return ok({ cotizacion: await leerTarjeta(contexto.params.id) }, contexto.cabeceras);
  }


  // Borrado suave: la tarjeta sale del tablero pero queda la historia y la
  // bitácora (permite deshacer con un update, sin haber perdido nada).
  async function borrarCotizacion(request, contexto) {
    const { rows } = await query(
      "update cotizaciones set borrada_en = now(), movida = now(), movida_por = $2" +
      " where id = $1 and borrada_en is null returning columna",
      [contexto.params.id, contexto.usuario.nombre]
    );
    if (!rows[0]) return fallo("Esa cotización ya no está en el tablero.", 404, contexto.cabeceras);
    await query(
      "insert into movimientos (cotizacion_id, de_columna, a_columna, usuario) values ($1, $2, null, $3)",
      [contexto.params.id, rows[0].columna, contexto.usuario.nombre]
    );
    return ok({ id: contexto.params.id }, contexto.cabeceras);
  }

  // Archivos de impresión (Bambu Lab): necesita la carpeta stl/ (opciones.impresion).
  async function impresion(request, contexto) {
    if (typeof opciones.impresion !== "function") {
      return fallo("La impresión 3D no está disponible en este servidor.", 404, contexto.cabeceras);
    }
    const cuerpo = await leerJson(request);
    if (!cuerpo || typeof cuerpo !== "object") return fallo("Faltan los datos de la orden.", 400, contexto.cabeceras);
    try {
      const r = await opciones.impresion(cuerpo);
      return ok({
        archivos: r.archivos.map((a) => ({ nombre: a.nombre, datos: a.datos.toString("base64") })),
        resumen: r.resumen
      }, contexto.cabeceras);
    } catch (error) {
      if (error && error.estado === 400) return fallo(error.message, 400, contexto.cabeceras);
      throw error;
    }
  }

  function salud(request, contexto) {
    return ok({ ok: true, api: "cotizador-cubica3d", hora: ahora().toISOString() }, contexto.cabeceras);
  }

  /* --------------------------------- Rutas --------------------------------- */

  const RUTAS = [
    { metodo: "GET",    patron: /^\/(?:api\/?)?$/,                            publica: true, fn: salud },
    { metodo: "POST",   patron: /^\/api\/login$/,                             publica: true, fn: login },
    { metodo: "GET",    patron: /^\/api\/pin$/,                               publica: true, fn: estadoPin },
    { metodo: "POST",   patron: /^\/api\/pin$/,                               publica: true, fn: verificarPin },
    { metodo: "POST",   patron: /^\/api\/acceso$/,                            publica: true, fn: accesoAutomatico },
    { metodo: "POST",   patron: /^\/api\/logout$/,                                           fn: logout },
    { metodo: "GET",    patron: /^\/api\/bootstrap$/,                                        fn: bootstrap },
    { metodo: "GET",    patron: /^\/api\/tablero$/,                                          fn: tablero },
    { metodo: "GET",    patron: /^\/api\/folio$/,                                            fn: folio },
    { metodo: "POST",   patron: /^\/api\/impresion$/,                                       fn: impresion },
    { metodo: "PUT",    patron: /^\/api\/config$/,                                           fn: guardarConfig },
    { metodo: "POST",   patron: /^\/api\/cotizaciones$/,                                     fn: crearCotizacion },
    { metodo: "PUT",    patron: /^\/api\/cotizaciones\/([0-9a-fA-F-]{36})$/,                 fn: editarCotizacion },
    { metodo: "PATCH",  patron: /^\/api\/cotizaciones\/([0-9a-fA-F-]{36})$/,                 fn: moverCotizacion },
    { metodo: "DELETE", patron: /^\/api\/cotizaciones\/([0-9a-fA-F-]{36})$/,                 fn: borrarCotizacion }
  ];

  async function manejar(request) {
    const cabeceras = cors(request);
    if (!cabeceras) {
      return new Response(JSON.stringify({ error: "Origen no autorizado." }), {
        status: 403, headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cabeceras });

    const camino = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    let ruta = null;
    let params = [];
    let huboRuta = false;
    for (const candidata of RUTAS) {
      const coincidencia = candidata.patron.exec(camino);
      if (!coincidencia) continue;
      huboRuta = true;
      if (candidata.metodo !== request.method) continue;
      ruta = candidata;
      params = coincidencia.slice(1);
      break;
    }

    if (!ruta) {
      if (huboRuta) return fallo("Método no permitido en esta ruta.", 405, cabeceras);
      return fallo("Ruta no encontrada.", 404, cabeceras);
    }

    const contexto = { params: { id: params[0] || "" }, cabeceras: cabeceras, usuario: null };
    try {
      if (!ruta.publica) {
        contexto.usuario = await usuarioDe(request);
        if (!contexto.usuario) return fallo("Tu sesión venció. Volvé a entrar.", 401, cabeceras);
      }
      return await ruta.fn(request, contexto);
    } catch (error) {
      log("[api] falló " + request.method + " " + camino, error);
      return fallo("Algo falló en el servidor. Probá de nuevo.", 500, cabeceras);
    }
  }

  return { fetch: manejar };
}

/* --------------------------- Enlace con la base --------------------------- */
// La cadena llega por DATABASE_URL: en Netlify se pega una vez en las variables
// de entorno del sitio (Site configuration -> Environment variables); en Neon la
// inyecta el runtime solo. El pool se crea una sola vez por instancia, que es de
// vida larga.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  // Si la cadena está mal, mejor un error claro que una petición colgada:
  connectionTimeoutMillis: 10000
});

// El pooler de Neon corta las conexiones que quedan inactivas. Cuando una vuelve
// muerta, `pg` avisa por acá: se tira ese cliente y la próxima consulta abre
// otro. Sin este manejador, el evento suelto se lleva puesto el proceso entero.
pool.on("error", function (error) {
  console.error("[api] se cayó una conexión del pool:", error.message);
});

// Las opciones que salen del entorno (el .env), en un solo lugar: así el servidor
// local las reusa cuando la base no es Neon (api/tools/base-local.js) y no hay dos
// listas de variables que se puedan desincronizar.
// La carpeta stl/ con las piezas: junto al proyecto en local; en Netlify llega con la
// función (included_files de netlify.toml), así que se prueban los sitios habituales.
function carpetaSTL() {
  const candidatas = [
    fileURLToPath(new URL("../../stl", import.meta.url)),
    join(process.cwd(), "stl"),
    join(process.env.LAMBDA_TASK_ROOT || "/var/task", "stl")
  ];
  return candidatas.find((c) => existsSync(c)) || candidatas[0];
}

export function opcionesDeEntorno(query) {
  return {
    query: query,
    impresion: (pedido) => generar(pedido, carpetaSTL()),
    origenPermitido: process.env.APP_ORIGEN || "",
    // El PIN del taller: con 4 dígitos acá, la app queda cerrada con llave (ver
    // el encabezado). Vacío = entra sola, como siempre.
    pin: process.env.PIN || "",
    // Entrada de la app: la prende o la apaga el .env del servidor (ver arriba).
    // El navegador no manda nada: sólo pregunta si puede entrar.
    acceso: {
      libre: process.env.ACCESO_LIBRE || "",
      automatico: process.env.ACCESO_AUTOMATICO || "",
      email: process.env.ACCESO_EMAIL || "",
      clave: process.env.ACCESO_CLAVE || ""
    }
  };
}

// La consulta contra el pool de Neon, para que otro punto de entrada (el servidor
// local) pueda armar su propia app con la misma base y las mismas opciones.
export const consultarNeon = (sql, parametros) => pool.query(sql, parametros);

export default crearApp(opcionesDeEntorno(consultarNeon));




