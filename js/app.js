/* Arranque de la app: sesión + enrutador por hash + pestañas + indicador del
 * carrito + toast.
 * Rutas: #/productos, #/productos/llaveros, #/carrito, #/proceso, #/estadisticas,
 * #/configuracion (Configuración se abre desde el engranito del encabezado, no es
 * una pestaña.)
 *
 * Secuencia de arranque: primero se le pregunta al servidor si el cotizador pide
 * PIN (GET /api/pin). Si lo pide, aparece el pinpad (js/pin.js) y no se entra hasta
 * que los 4 dígitos estén bien; al cuarto dígito se verifica solo (no hay botón de
 * entrar) y el servidor abre la sesión. Si no pide PIN, se entra sola como siempre:
 * se le pide una sesión al servidor (POST /api/acceso) y el API la abre con la
 * cuenta del taller, sin correo ni contraseña (no hay pantalla de login: ver
 * js/acceso.js y el encabezado de api/functions/api.js).
 * Con la sesión lista se pide /api/bootstrap (configuración, tablero y folio de una
 * sola vez) y recién entonces se pinta. Después, cada 15 s se vuelve a preguntar
 * por el tablero: así lo que envía o mueve otro compañero aparece solo.
 * Se expone como window.App */
(function () {
  'use strict';

  var VALID_ROUTES = ['productos', 'carrito', 'proceso', 'estadisticas', 'configuracion'];
  var DEFAULT_ROUTE = 'productos';

  // Rutas viejas: se reescriben a las nuevas para que los enlaces guardados
  // sigan funcionando.
  var ALIASES = { cotizacion: 'productos', trabajos: 'proceso' };

  var viewEl = document.getElementById('view');
  var tabsEl = document.getElementById('tabs');
  var toastEl = document.getElementById('toast');
  var cartChip = document.getElementById('cart-chip');
  var cartCountEl = document.getElementById('cart-count');
  var cartTotalEl = document.getElementById('cart-total');
  var gearBtn = document.getElementById('btn-config');
  var userChip = document.getElementById('user-chip');
  var toastTimer = null;
  var sondeo = null;        // timer que refresca el tablero desde la base
  var SONDA_MS = 15000;     // cada cuánto se pregunta si alguien del taller cambió algo

  // "#/productos/llaveros" -> { route: 'productos', sub: 'llaveros' }
  function parseHash() {
    var partes = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    var route = partes[0];
    if (ALIASES[route]) route = ALIASES[route];
    if (VALID_ROUTES.indexOf(route) < 0) route = DEFAULT_ROUTE;
    return { route: route, sub: partes[1] || null };
  }

  // Si se entró por una ruta vieja (#/cotizacion, #/trabajos) se normaliza la
  // barra de direcciones: el hashchange que provoca location.replace vuelve a
  // llamar a render(), así que aquí solo se avisa que hubo reescritura.
  function normalizarRuta() {
    var partes = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!ALIASES[partes[0]]) return false;
    location.replace('#/' + ALIASES[partes[0]] + (partes[1] ? '/' + partes[1] : ''));
    return true;
  }

  function viewFor(route) {
    switch (route) {
      case 'carrito': return window.Views.carrito;
      case 'proceso': return window.Views.proceso;
      case 'estadisticas': return window.Views.estadisticas;
      case 'configuracion': return window.Views.configuracion;
      default: return window.Views.productos;
    }
  }

  // Refresca el chip "🛒 2 · $200.00" del header. Se ejecuta al navegar y en
  // cada cambio del carrito (window.Cart.subscribe), desde cualquier pestaña.
  function refreshCartChip() {
    if (!cartChip) return;
    var unidades = window.Cart.getUnidades();
    cartCountEl.textContent = String(unidades);
    cartTotalEl.textContent = window.Utils.formatMoney(window.Cart.getTotal());
    cartChip.classList.toggle('cart-chip--empty', unidades === 0);
  }

  function render() {
    // Sin sesión manda la pantalla de acceso: no hay nada que pintar todavía.
    if (!window.Api.haySesion()) return;

    // Y con el pinpad delante tampoco: todavía no se entró.
    if (window.Pin && window.Pin.visible()) return;

    // Las rutas viejas se reescriben antes de pintar (ver normalizarRuta).
    if (normalizarRuta()) return;

    var hash = parseHash();

    // #/carrito es parte del flujo de Productos, así que su pestaña queda activa.
    var tabRoute = hash.route === 'carrito' ? 'productos' : hash.route;

    tabsEl.querySelectorAll('.tab').forEach(function (tab) {
      var active = tab.getAttribute('data-route') === tabRoute;
      tab.classList.toggle('tab--active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    // El engranito se resalta mientras se está en Configuración.
    if (gearBtn) {
      var enConfig = hash.route === 'configuracion';
      gearBtn.classList.toggle('icon-btn--activo', enConfig);
      if (enConfig) {
        gearBtn.setAttribute('aria-current', 'page');
      } else {
        gearBtn.removeAttribute('aria-current');
      }
    }

    viewEl.innerHTML = '';
    viewFor(hash.route).render(viewEl, hash.sub);
    refreshCartChip();
  }

  // navigate('productos') | navigate('productos/llaveros') | navigate('proceso') ...
  function navigate(path) {
    var destino = '#/' + String(path == null ? DEFAULT_ROUTE : path).replace(/^#?\/?/, '');
    if (location.hash === destino) {
      render();
      return;
    }
    location.hash = destino;
  }

  function toast(message, type) {
    toastEl.textContent = message;
    toastEl.className = 'toast toast--show' + (type ? ' toast--' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.className = 'toast';
    }, 2200);
  }

  /* --------------------------- Sesión y arranque --------------------------- */

  // Muestra quién está adentro (el nombre del usuario que devuelve el API).
  function pintarUsuario(usuario) {
    if (!userChip) return;
    usuario = usuario || {};
    var nombre = usuario.nombre || usuario.email || '';
    userChip.textContent = nombre;
    userChip.title = usuario.email || '';
    userChip.hidden = !nombre;
  }

  // Refresca el tablero cada 15 s: lo que envió o movió un compañero desde otro
  // equipo aparece solo. Con la pestaña en segundo plano no se pregunta nada.
  function arrancarSondeo() {
    if (sondeo) return;
    sondeo = setInterval(function () {
      if (document.hidden) return;
      if (window.Proceso.ocupado()) return;   // hay una escritura sin confirmar
      window.Proceso.recargar();
    }, SONDA_MS);
  }

  function detenerSondeo() {
    clearInterval(sondeo);
    sondeo = null;
  }

  // Muestra el aviso de arranque (no se pudo entrar, sesión vencida o error de
  // carga): es la pantalla que explica el motivo y deja reintentar. No pide nada:
  // la app no tiene login (ver js/acceso.js).
  function avisoDeAcceso(mensaje) {
    detenerSondeo();
    window.Acceso.mostrar(mensaje || '');
  }

  // Le pide la sesión al servidor (POST /api/acceso): el API la abre sola con la
  // cuenta del taller, sin correo ni contraseña. Si no puede, queda el aviso con
  // el motivo y el botón «Reintentar».
  function entrarSolo(mensaje) {
    if (!window.Api.accesoAutomatico) {   // api.js viejo en caché
      avisoDeAcceso(mensaje);
      return Promise.resolve(null);
    }
    return window.Api.accesoAutomatico().then(function (resultado) {
      if (resultado && resultado.automatico) return iniciar();
      avisoDeAcceso((resultado && resultado.aviso) || mensaje || '');
      return null;
    });
  }

  // Muestra el pinpad: el cotizador no se abre hasta que los 4 dígitos estén bien
  // (ver js/pin.js). El fondo queda quieto, como con el aviso de arranque.
  function pedirPin(mensaje) {
    detenerSondeo();
    if (!window.Pin) return;    // frontend viejo en caché: no hay pinpad que mostrar
    window.Pin.mostrar(mensaje || '');
  }

  // El arranque de verdad: primero se averigua si este cotizador pide PIN. Si lo
  // pide, se muestra el pinpad y se espera (el servidor no da sesión sin los 4
  // dígitos); si no, se entra sola como siempre.
  function arrancar() {
    // api.js viejo en caché (sin la ruta del PIN): se entra como antes.
    if (!window.Api.pinRequerido) return entrarSolo('');
    return window.Api.pinRequerido().then(function (datos) {
      if (datos && datos.requerido) {
        pedirPin(datos.aviso || '');
        return null;
      }
      return entrarSolo('');
    });
  }

  // Trae todo de la base en UNA llamada (config + tablero + folio) y recién ahí
  // pinta. Si el API no contesta, se vuelve al acceso con el motivo a la vista.
  function iniciar() {
    return window.Api.bootstrap().then(function (datos) {
      window.Store.init(datos.config, datos.configActualizada);
      window.Proceso.init(datos);
      window.Acceso.ocultar();
      if (window.Pin) window.Pin.ocultar();   // si se entró con PIN, se va el pinpad
      pintarUsuario(datos.usuario);
      arrancarSondeo();
      if (!location.hash) location.hash = '#/' + DEFAULT_ROUTE;
      render();
      return datos;
    }, function (error) {
      avisoDeAcceso(error.message || 'No se pudo cargar la información del taller.');
      return null;
    });
  }

  tabsEl.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (!tab) return;
    navigate(tab.getAttribute('data-route'));
  });

  // El chip del carrito abre el desglose de la cotización (#/carrito), donde
  // se capturan los datos del cliente, se envía al tablero y se saca el PDF.
  if (cartChip) {
    cartChip.addEventListener('click', function () {
      navigate('carrito');
    });
  }

  // El engranito del encabezado abre Configuración (ya no es una pestaña).
  if (gearBtn) {
    gearBtn.addEventListener('click', function () {
      navigate('configuracion');
    });
  }

  // Si el servidor dice que la sesión venció (o borraron la cuenta), se vuelve a
  // arrancar: con PIN puesto lo va a pedir de nuevo, y sin PIN se pide una sesión
  // nueva sin que haya nada que escribir.
  window.Api.onSesionVencida(function () {
    arrancar();
  });

  window.addEventListener('hashchange', render);
  window.Cart.subscribe(refreshCartChip);

  window.App = {
    render: render,
    navigate: navigate,
    toast: toast,
    refreshCartChip: refreshCartChip,
    parseHash: parseHash,
    ALIASES: ALIASES,
    iniciar: iniciar,
    entrarSolo: entrarSolo,
    arrancar: arrancar
  };

  // El carrito es un borrador local: se muestra en el chip aunque todavía no se
  // haya entrado, así al entrar ya está todo a la vista.
  refreshCartChip();

  // Arranque. `Acceso.init` conecta el «Reintentar» del aviso con este mismo
  // arranque, y `Pin.init` deja el pinpad listo: cuando los 4 dígitos están bien,
  // el servidor ya abrió la sesión y sólo hay que entrar (el pinpad se oculta solo
  // antes de avisar). Si el cotizador no pide PIN, todo esto se saltea y se entra
  // sola, como siempre.
  window.Acceso.init(arrancar);
  // `Pin` puede faltar si el navegador quedó con una mezcla vieja en caché: sin él
  // no hay pinpad, pero la app no se rompe (y el servidor no da sesión igual).
  if (window.Pin) {
    window.Pin.init({
      verificar: function (pin) { return window.Api.verificarPin(pin); },
      alEntrar: function () { iniciar(); }
    });
  }
  arrancar();
})();
