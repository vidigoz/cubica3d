/* Arranque de la app: sesión + enrutador por hash + pestañas + indicador del
 * carrito + toast.
 * Rutas: #/productos, #/productos/llaveros, #/carrito, #/proceso, #/configuracion
 * (Configuración se abre desde el engranito del encabezado, no es una pestaña.)
 *
 * Secuencia de arranque: si hay sesión guardada se pide /api/bootstrap (que trae
 * de una sola vez la configuración, el tablero y el folio que sigue) y recién
 * entonces se pinta. Si no hay sesión, antes de mostrar el formulario se le
 * pregunta al servidor si tiene prendido el acceso automático (POST /api/acceso):
 * con ACCESO_AUTOMATICO=true en el .env del API la app entra sola; si no,
 * aparece la pantalla de acceso de siempre.
 * Después, cada 15 s se vuelve a preguntar por el tablero: así lo que envía o
 * mueve otro compañero aparece solo.
 * Se expone como window.App */
(function () {
  'use strict';

  var VALID_ROUTES = ['productos', 'carrito', 'proceso', 'configuracion'];
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
  var salirBtn = document.getElementById('btn-salir');
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

  // Vuelve a la pantalla de acceso (sesión vencida, «Salir» o error de arranque).
  function pedirAcceso(mensaje) {
    detenerSondeo();
    window.Acceso.mostrar(mensaje || '');
  }

  // Intenta entrar sola con la cuenta que el servidor tiene en su .env; si el
  // acceso automático está apagado, muestra el formulario (con el motivo, si lo
  // hay). No se usa al cerrar sesión a propósito: si no, «Salir» no serviría.
  function entrarSoloOLogin(mensaje) {
    if (!window.Api.accesoAutomatico) {   // api.js viejo en caché
      pedirAcceso(mensaje);
      return Promise.resolve(null);
    }
    return window.Api.accesoAutomatico().then(function (resultado) {
      if (resultado && resultado.automatico) return iniciar();
      pedirAcceso((resultado && resultado.aviso) || mensaje || '');
      return null;
    });
  }

  // Trae todo de la base en UNA llamada (config + tablero + folio) y recién ahí
  // pinta. Si el API no contesta, se vuelve al acceso con el motivo a la vista.
  function iniciar() {
    return window.Api.bootstrap().then(function (datos) {
      window.Store.init(datos.config, datos.configActualizada);
      window.Proceso.init(datos);
      window.Acceso.ocultar();
      pintarUsuario(datos.usuario);
      arrancarSondeo();
      if (!location.hash) location.hash = '#/' + DEFAULT_ROUTE;
      render();
      return datos;
    }, function (error) {
      pedirAcceso(error.message || 'No se pudo cargar la información del taller.');
      return null;
    });
  }

  function cerrarSesion() {
    if (salirBtn) salirBtn.disabled = true;
    window.Api.logout().then(function () {
      if (salirBtn) salirBtn.disabled = false;
      pintarUsuario(null);
      pedirAcceso('Sesión cerrada.');
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

  // «Salir»: se le avisa al servidor (borra la sesión en la base) y se limpia acá.
  if (salirBtn) {
    salirBtn.addEventListener('click', cerrarSesion);
  }

  // Si el servidor dice que la sesión venció (o borraron el usuario), se prueba
  // entrar sola con el acceso automático y, si está apagado, se pide el correo.
  window.Api.onSesionVencida(function () {
    entrarSoloOLogin('Tu sesión venció. Volvé a entrar.');
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
    cerrarSesion: cerrarSesion
  };

  // El carrito es un borrador local: se muestra en el chip aunque todavía no se
  // haya entrado, así al entrar ya está todo a la vista.
  refreshCartChip();

  // Arranque: con sesión guardada se entra directo; sin sesión (o si venció), se
  // prueba el acceso automático y, si está apagado, se pide el correo.
  window.Acceso.init(iniciar);
  if (window.Api.haySesion()) {
    iniciar();
  } else {
    entrarSoloOLogin('');
  }
})();
