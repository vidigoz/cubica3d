/* Arranque de la app: enrutador por hash + pestañas + indicador del carrito + toast.
 * Rutas: #/productos, #/productos/llaveros, #/carrito, #/proceso, #/configuracion
 * (Configuración se abre desde el engranito del encabezado, no es una pestaña.)
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
  var toastTimer = null;

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

  window.addEventListener('hashchange', render);
  window.Cart.subscribe(refreshCartChip);

  window.App = {
    render: render,
    navigate: navigate,
    toast: toast,
    refreshCartChip: refreshCartChip,
    parseHash: parseHash,
    ALIASES: ALIASES
  };

  if (!location.hash) {
    location.hash = '#/' + DEFAULT_ROUTE;
  }
  render();
})();
