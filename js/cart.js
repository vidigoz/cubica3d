/* Carrito de cotización, compartido entre todos los productos.
 * Guarda las líneas y los datos de la cotización (folio, fecha, cliente, notas).
 *
 * Esto es lo ÚNICO que sigue viviendo en este navegador: el carrito es un
 * borrador personal que se está armando, y se persiste en localStorage para no
 * perderlo al recargar. Recién al pulsar «Enviar cotización» viaja al API y
 * queda guardado en Postgres (ver js/proceso.js y js/views/carrito.js).
 * Se expone como window.Cart */
(function () {
  'use strict';

  var STORAGE_KEY = 'cotizador.carrito.v1';

  // Líneas: { id, tipo, titulo, detalles: [{ label, nombre, hex }], precio, cantidad }
  //   precio = precio UNITARIO. El importe de la línea es precio * cantidad.
  var items = [];
  var meta = null;
  // Identificador de ESTE carrito. Viaja con el envío para que un doble clic (o
  // un reintento de red) no guarde la misma cotización dos veces: el servidor
  // reconoce el clientId y devuelve la tarjeta que ya había creado.
  var clientId = window.Utils.uid();
  var listeners = [];

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function hoyISO() {
    var d = new Date();
    var mes = String(d.getMonth() + 1);
    var dia = String(d.getDate());
    if (mes.length < 2) mes = '0' + mes;
    if (dia.length < 2) dia = '0' + dia;
    return d.getFullYear() + '-' + mes + '-' + dia;
  }

  function metaNueva(folio) {
    return { folio: String(folio || '1'), fecha: hoyISO(), cliente: '', notas: '' };
  }

  function folioSiguiente(actual) {
    var n = parseInt(actual, 10);
    return String(isFinite(n) && n > 0 ? n + 1 : 1);
  }

  // Cantidad siempre es un entero >= 1.
  function cantidadValida(valor) {
    var n = Math.floor(window.Utils.parseNumber(valor, 1));
    return n > 0 ? n : 1;
  }

  function detallesValidos(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.map(function (d) {
      d = d || {};
      return {
        label: d.label == null ? '' : String(d.label),
        nombre: d.nombre == null ? '' : String(d.nombre),
        hex: d.hex == null ? '' : String(d.hex)
      };
    });
  }

  /* ------------------------- Persistencia ------------------------- */

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: items, meta: meta, clientId: clientId }));
    } catch (e) {
      /* Si el almacenamiento no está disponible, se sigue trabajando en memoria. */
    }
  }

  // Carga lo guardado y lo sanea; si algo viene mal, arranca vacío.
  function cargar() {
    var guardado = null;
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) guardado = JSON.parse(raw);
    } catch (e) {
      guardado = null;
    }

    if (guardado && typeof guardado.clientId === 'string' && guardado.clientId) {
      clientId = guardado.clientId;
    }

    if (guardado && Array.isArray(guardado.items)) {
      items = guardado.items.filter(function (it) {
        return it && typeof it.titulo === 'string';
      }).map(function (it) {
        return {
          id: it.id || window.Utils.uid(),
          tipo: it.tipo || 'Producto',
          titulo: it.titulo,
          detalles: detallesValidos(it.detalles),
          precio: window.Utils.parseNumber(it.precio, 0),
          cantidad: cantidadValida(it.cantidad)
        };
      });
    }

    var m = (guardado && guardado.meta) ? guardado.meta : {};
    meta = {
      folio: (m.folio === '' || m.folio == null) ? '1' : String(m.folio),
      fecha: String(m.fecha || hoyISO()),
      cliente: m.cliente == null ? '' : String(m.cliente),
      notas: m.notas == null ? '' : String(m.notas)
    };
  }

  cargar();

  /* ---------------------------- Lectura ---------------------------- */

  // Devuelve copias profundas: nadie de fuera puede alterar el carrito por
  // accidente (los objetos originales quedan protegidos).
  function getItems() {
    return items.map(function (item) {
      return {
        id: item.id,
        tipo: item.tipo,
        titulo: item.titulo,
        detalles: detallesValidos(item.detalles),
        precio: item.precio,
        cantidad: item.cantidad
      };
    });
  }

  // Importe de una línea: precio unitario x cantidad.
  function getLineTotal(item) {
    if (!item) return 0;
    return window.Utils.parseNumber(item.precio, 0) * cantidadValida(item.cantidad);
  }

  function getCount() { return items.length; }            // productos distintos
  function getUnidades() {                                 // piezas totales
    return items.reduce(function (sum, item) { return sum + item.cantidad; }, 0);
  }
  function getTotal() {
    return items.reduce(function (sum, item) { return sum + getLineTotal(item); }, 0);
  }

  function getMeta() { return clone(meta); }

  // Identificador del carrito actual: viaja en el envío (ver js/views/carrito.js).
  function getClientId() { return clientId; }

  /* --------------------------- Escritura --------------------------- */

  function notify() {
    listeners.forEach(function (fn) { fn(getItems()); });
  }

  // Agrega un producto al carrito. Devuelve la línea creada.
  function add(item) {
    item = item || {};
    var linea = {
      id: window.Utils.uid(),
      tipo: item.tipo || 'Producto',
      titulo: item.titulo || '',
      detalles: detallesValidos(item.detalles),
      precio: window.Utils.parseNumber(item.precio, 0),
      cantidad: cantidadValida(item.cantidad)
    };
    items.push(linea);
    persist();
    notify();
    return clone(linea);
  }

  // Cambia la cantidad de una línea (mínimo 1). Devuelve true si cambió.
  function setCantidad(id, cantidad) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id !== id) continue;
      var n = cantidadValida(cantidad);
      if (items[i].cantidad === n) return false;
      items[i].cantidad = n;
      persist();
      notify();
      return true;
    }
    return false;
  }

  function remove(id) {
    var antes = items.length;
    items = items.filter(function (i) { return i.id !== id; });
    if (items.length === antes) return false;
    persist();
    notify();
    return true;
  }

  // Vacía el carrito y arranca una cotización nueva (folio siguiente, datos limpios).
  function clear() {
    if (!items.length) return false;
    items = [];
    meta = metaNueva(folioSiguiente(meta.folio));
    clientId = window.Utils.uid();   // carrito nuevo: envío nuevo, sin duplicados
    persist();
    notify();
    return true;
  }

  // Cambia los datos de la cotización (folio, fecha, cliente, notas).
  // NO avisa a los suscriptores: no son líneas del carrito, y avisar repintaría
  // la vista justo mientras el usuario está escribiendo.
  function setMeta(patch) {
    patch = patch || {};
    ['folio', 'fecha', 'cliente', 'notas'].forEach(function (clave) {
      if (patch[clave] === undefined) return;
      meta[clave] = patch[clave] == null ? '' : String(patch[clave]);
    });
    persist();
    return getMeta();
  }

  // Permite que las vistas reaccionen a cambios del carrito.
  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  window.Cart = {
    STORAGE_KEY: STORAGE_KEY,
    getItems: getItems,
    getLineTotal: getLineTotal,
    getCount: getCount,
    getUnidades: getUnidades,
    getTotal: getTotal,
    getMeta: getMeta,
    getClientId: getClientId,
    setMeta: setMeta,
    add: add,
    setCantidad: setCantidad,
    remove: remove,
    clear: clear,
    subscribe: subscribe
  };
})();
