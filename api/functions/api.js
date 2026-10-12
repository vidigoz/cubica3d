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
 *   POST   /api/cotizaciones          { clientId, meta, items }      -> tarjeta creada
 *   PATCH  /api/cotizaciones/:id      { columna }                    -> tarjeta movida
 *   DELETE /api/cotizaciones/:id                                     -> { ok }
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
import { Pool } from "pg";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";

const COLUMNAS = ["cotizacion", "trabajo", "realizado"];   // las tres del Kanban
const DIAS_SESION = 30;
const INTENTOS_MAX = 10;                                   // por correo...
const INTENTOS_VENTANA_MS = 15 * 60 * 1000;                // ...cada 15 minutos
const SCRYPT = { N: 16384, r: 8, p: 1, largo: 64, sal: 16 };
const LIMITE = { cliente: 120, notas: 600, titulo: 120, tipo: 40 };
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

// Lo que la gente escribe en el .env para decir "sí": true / 1 / si / on / yes.
const esVerdadero = (valor) => valor === true ||
  ["1", "true", "si", "sí", "on", "yes", "verdadero"].includes(texto(valor).trim().toLowerCase());

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

function preciosValidos(precios) {
  const p = precios || {};
  const c = p.clicer || {};
  return {
    nombre: numero(p.nombre, 0),
    nombreApellido: numero(p.nombreApellido, 0),
    clicer: {
      porLetraCorto: Math.max(0, redondear(numeroODefecto(c.porLetraCorto, CLICER_POR_DEFECTO.porLetraCorto))),
      porLetraLargo: Math.max(0, redondear(numeroODefecto(c.porLetraLargo, CLICER_POR_DEFECTO.porLetraLargo))),
      letrasCorte: Math.max(1, Math.floor(numeroODefecto(c.letrasCorte, CLICER_POR_DEFECTO.letrasCorte)))
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
      total: Number(fila.total),
      columna: fila.columna,
      posicion: Number(fila.posicion),
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
      " posicion, unidades, total, creada, movida, creada_por, movida_por" +
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
      " posicion, unidades, total, creada, movida, creada_por, movida_por" +
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

  const SQL_NUEVA = `
    with posicion as (
      select coalesce(min(posicion), 1000) - 1000 as p
        from cotizaciones where columna = 'cotizacion' and borrada_en is null
    ), nueva as (
      insert into cotizaciones (client_id, folio, fecha, cliente, notas, columna, posicion,
                                unidades, total, creada_por, movida_por)
      select $1::text, siguiente_folio(), coalesce($2::date, current_date), $3, $4,
             'cotizacion', p.p, $5::int, $6::numeric, $7, $7
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
    const total = redondear(items.reduce((suma, it) => suma + it.precio * it.cantidad, 0));
    const parametros = [
      clientId,
      texto(meta.fecha) || null,
      recortar(meta.cliente, LIMITE.cliente),
      recortar(meta.notas, LIMITE.notas),
      unidades,
      total,
      contexto.usuario.nombre,
      JSON.stringify(items)
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

  async function moverCotizacion(request, contexto) {
    const cuerpo = (await leerJson(request)) || {};
    const columna = texto(cuerpo.columna);
    if (COLUMNAS.indexOf(columna) < 0) return fallo("Columna inválida.", 400, contexto.cabeceras);

    const { rows } = await query(
      "select columna from cotizaciones where id = $1 and borrada_en is null", [contexto.params.id]
    );
    const actual = rows[0];
    if (!actual) return fallo("Esa cotización ya no está en el tablero.", 404, contexto.cabeceras);
    if (actual.columna === columna) {
      return ok({ cotizacion: await leerTarjeta(contexto.params.id), sinCambios: true }, contexto.cabeceras);
    }

    // Igual que en el frontend: la tarjeta entra ARRIBA de la columna destino.
    const { rows: destino } = await query(
      "select coalesce(min(posicion), 1000) - 1000 as p from cotizaciones" +
      " where columna = $1 and borrada_en is null and id <> $2",
      [columna, contexto.params.id]
    );
    await query(
      "update cotizaciones set columna = $2, posicion = $3, movida = now(), movida_por = $4" +
      " where id = $1",
      [contexto.params.id, columna, Number(destino[0].p), contexto.usuario.nombre]
    );
    await query(
      "insert into movimientos (cotizacion_id, de_columna, a_columna, usuario) values ($1, $2, $3, $4)",
      [contexto.params.id, actual.columna, columna, contexto.usuario.nombre]
    );
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
    { metodo: "PUT",    patron: /^\/api\/config$/,                                           fn: guardarConfig },
    { metodo: "POST",   patron: /^\/api\/cotizaciones$/,                                     fn: crearCotizacion },
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
export function opcionesDeEntorno(query) {
  return {
    query: query,
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




