/* Cliente del API del cotizador: la única puerta del navegador hacia Postgres.
 *
 * El navegador NUNCA ve la cadena de conexión (una web no puede abrir sockets a
 * Postgres, y la contraseña quedaría a la vista). Habla siempre con /api, que es
 * la función que sí tiene la cadena y escribe en Neon.
 *
 *   POST   /login        { email, password } -> { token, usuario }
 *   GET    /pin                              -> { requerido, digitos }
 *   POST   /pin          { pin }             -> { token, usuario }
 *   POST   /acceso       (sin cuerpo)        -> { automatico, token?, usuario?, aviso? }
 *   POST   /logout
 *   GET    /bootstrap    -> config + tablero + folio (todo de una sola vez)
 *   GET    /tablero
 *   GET    /folio
 *   PUT    /config       { colores, precios }
 *   POST   /cotizaciones { clientId, meta, items }
 *   PATCH  /cotizaciones/:id  { columna }
 *   DELETE /cotizaciones/:id
 *
 * La sesión (token + usuario) se guarda en localStorage: dura 30 días y así no
 * hay que entrar cada vez que se abre la app. Todos los métodos devuelven
 * promesas y, si algo falla, rechazan con un Error que trae `estado` (0 = no
 * hubo respuesta) y un mensaje ya en castellano para mostrar tal cual.
 *
 * Se expone como window.Api. Con `window.CUBICA_API` se puede apuntar a otra
 * base (por ejemplo el servidor local: http://localhost:8787/api). */
(function () {
  'use strict';

  // Mismo origen por defecto: netlify dev y el sitio publicado sirven el API en /api.
  var BASE = String(window.CUBICA_API || '/api').replace(/\/+$/, '');
  var SESION_KEY = 'cotizador.sesion.v1';
  var INTERNET = 'No se pudo hablar con el servidor. Revisá tu conexión.';

  var sesion = leerSesion();
  var avisos = [];   // funciones a llamar cuando el servidor diga que la sesión venció

  function leerSesion() {
    try {
      var guardada = JSON.parse(window.localStorage.getItem(SESION_KEY) || 'null');
      if (!guardada || typeof guardada.token !== 'string' || !guardada.token) return null;
      return guardada;
    } catch (e) {
      return null;
    }
  }

  function guardarSesion(datos) {
    sesion = datos;
    try {
      window.localStorage.setItem(SESION_KEY, JSON.stringify(datos));
    } catch (e) {
      /* Si el almacenamiento no está disponible, la sesión dura lo que la pestaña. */
    }
  }

  function olvidarSesion() {
    sesion = null;
    try {
      window.localStorage.removeItem(SESION_KEY);
    } catch (e) {
      /* nada que limpiar */
    }
  }

  function falla(mensaje, estado) {
    var error = new Error(mensaje);
    error.estado = estado || 0;
    return error;
  }

  // Petición cruda. `opciones.publica` marca las rutas que no llevan token
  // (hoy /login, /pin y /acceso), para no tratar su 401 como "sesión vencida".
  function pedir(metodo, camino, cuerpo, opciones) {
    opciones = opciones || {};
    var cabeceras = {};
    if (!opciones.publica && sesion && sesion.token) cabeceras.Authorization = 'Bearer ' + sesion.token;
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';

    return window.fetch(BASE + camino, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    }).then(function (respuesta) {
      return respuesta.text().then(function (texto) {
        var datos = null;
        try {
          datos = texto ? JSON.parse(texto) : null;
        } catch (e) {
          datos = null;   // una respuesta que no es JSON (página de error, por ejemplo)
        }

        // El token venció o lo borraron: se avisa para volver a la pantalla de acceso.
        if (respuesta.status === 401 && !opciones.publica) {
          olvidarSesion();
          avisos.forEach(function (fn) { fn(); });
          throw falla((datos && datos.error) || 'Tu sesión venció. Volvé a entrar.', 401);
        }
        if (!respuesta.ok) {
          throw falla((datos && datos.error) || 'El servidor contestó ' + respuesta.status + '.', respuesta.status);
        }
        return datos || {};
      });
    }, function () {
      // fetch sólo rechaza por fallas de red: acá no hubo respuesta alguna.
      throw falla(INTERNET, 0);
    });
  }

  /* ------------------------------- Sesión ------------------------------- */

  function login(email, password) {
    return pedir('POST', '/login', { email: email, password: password }, { publica: true })
      .then(function (datos) {
        guardarSesion({ token: datos.token, usuario: datos.usuario });
        return datos.usuario;
      });
  }

  // La sesión del taller: le pide al servidor que la abra con la cuenta que él
  // tiene (POST /api/acceso). La app no tiene login, así que este es el camino
  // normal de entrada; si el servidor no puede, avisa el motivo para mostrarlo en
  // el aviso de arranque. El navegador nunca ve la contraseña: sólo recibe el token.
  function accesoAutomatico() {
    return pedir('POST', '/acceso', {}, { publica: true })
      .then(function (datos) {
        if (!datos || !datos.automatico || !datos.token) {
          return { automatico: false, aviso: (datos && datos.aviso) || '' };
        }
        guardarSesion({ token: datos.token, usuario: datos.usuario });
        return { automatico: true, usuario: datos.usuario };
      })
      .catch(function (error) {
        // 404: el servidor todavía no tiene esta ruta (deploy viejo) -> se avisa
        // sin ruido. Otra falla (sin conexión, origen no autorizado) sí se muestra:
        // en el aviso de arranque hay que ver por qué no entró.
        return { automatico: false, aviso: (error && error.estado === 404) ? '' : (error.message || '') };
      });
  }

  function logout() {
    // El pedido se arma antes de olvidar la sesión (necesita el token vigente).
    var pendiente = sesion ? pedir('POST', '/logout').catch(function () { return {}; }) : Promise.resolve({});
    olvidarSesion();
    return pendiente;
  }

  /* -------------------------------- PIN -------------------------------- */

  // ¿Este cotizador pide PIN? Se pregunta al abrirse: si el servidor dice que sí,
  // la app muestra el pinpad en vez de entrar sola (ver js/pin.js). Si el servidor
  // es viejo y la ruta no existe (404), se responde que no para seguir como antes.
  function pinRequerido() {
    return pedir('GET', '/pin', undefined, { publica: true })
      .catch(function (error) {
        return { requerido: false, aviso: (error && error.estado === 404) ? '' : (error.message || '') };
      });
  }

  // Manda los 4 dígitos que se tipearon. Si están bien, el servidor abre la sesión
  // (la misma de siempre) y el token queda guardado; si no, se devuelve
  // { ok: false, mensaje } para que el pinpad lo muestre, sin romper nada: el 401
  // de esta ruta no es "sesión vencida" (es pública a propósito).
  function verificarPin(pin) {
    return pedir('POST', '/pin', { pin: pin }, { publica: true })
      .then(function (datos) {
        guardarSesion({ token: datos.token, usuario: datos.usuario });
        return { ok: true, usuario: datos.usuario };
      }, function (error) {
        return { ok: false, mensaje: (error && error.message) || '' };
      });
  }

  function onSesionVencida(fn) {
    avisos.push(fn);
  }

  /* ------------------------------ Lectura ------------------------------ */

  function bootstrap() { return pedir('GET', '/bootstrap'); }
  function tablero() { return pedir('GET', '/tablero'); }
  function folio() { return pedir('GET', '/folio'); }

  /* ----------------------------- Escritura ----------------------------- */

  function guardarConfig(config) {
    return pedir('PUT', '/config', {
      colores: config.colores,
      precios: config.precios
    });
  }

  function crearCotizacion(datos) {
    return pedir('POST', '/cotizaciones', {
      clientId: datos.clientId,
      meta: datos.meta,
      items: datos.items
    });
  }

  function moverCotizacion(id, columna) {
    return pedir('PATCH', '/cotizaciones/' + encodeURIComponent(id), { columna: columna });
  }

  function borrarCotizacion(id) {
    return pedir('DELETE', '/cotizaciones/' + encodeURIComponent(id));
  }

  window.Api = {
    BASE: BASE,
    haySesion: function () { return !!sesion; },
    usuario: function () { return sesion ? sesion.usuario : null; },
    login: login,
    accesoAutomatico: accesoAutomatico,
    pinRequerido: pinRequerido,
    verificarPin: verificarPin,
    logout: logout,
    onSesionVencida: onSesionVencida,
    bootstrap: bootstrap,
    tablero: tablero,
    folio: folio,
    guardarConfig: guardarConfig,
    crearCotizacion: crearCotizacion,
    moverCotizacion: moverCotizacion,
    borrarCotizacion: borrarCotizacion
  };
})();
