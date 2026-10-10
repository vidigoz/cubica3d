/* Tablero de proceso (Kanban) de las cotizaciones enviadas.
 * Cotización -> Trabajo -> Realizado.
 *
 * Cada tarjeta es una COPIA CONGELADA de la cotización tal como se envió: aquí
 * vive el historial de lo que ya se le mandó al cliente, así que editar el
 * carrito después no altera nada de lo guardado.
 * Se expone como window.Proceso */
(function () {
  'use strict';

  var STORAGE_KEY = 'cotizador.proceso.v1';

  // Las columnas del tablero, en orden. El orden ES el flujo de trabajo.
  var COLUMNAS = [
    { id: 'cotizacion', nombre: 'Cotización' },
    { id: 'trabajo', nombre: 'Trabajo' },
    { id: 'realizado', nombre: 'Realizado' }
  ];

  // Tarjetas: { id, folio, fecha, cliente, notas, items: [...], unidades, total,
  //             columna, creada, movida }
  var tarjetas = [];
  var listeners = [];

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function ahoraISO() { return new Date().toISOString(); }

  /* ------------------------- Catálogo de columnas ------------------------- */

  function getColumna(id) {
    for (var i = 0; i < COLUMNAS.length; i++) {
      if (COLUMNAS[i].id === id) return clone(COLUMNAS[i]);
    }
    return null;
  }

  function indiceColumna(id) {
    for (var i = 0; i < COLUMNAS.length; i++) {
      if (COLUMNAS[i].id === id) return i;
    }
    return -1;
  }

  function primeraColumna() { return COLUMNAS[0].id; }

  /* ----------------------------- Saneo ----------------------------- */

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

  function itemsValidos(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.filter(function (it) {
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

  function lineTotal(item) {
    return window.Utils.parseNumber(item.precio, 0) * cantidadValida(item.cantidad);
  }

  function unidadesDe(items) {
    return items.reduce(function (sum, item) { return sum + item.cantidad; }, 0);
  }

  function totalDe(items) {
    return items.reduce(function (sum, item) { return sum + lineTotal(item); }, 0);
  }

  /* --------------------------- Persistencia --------------------------- */

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tarjetas: tarjetas }));
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

    if (!guardado || !Array.isArray(guardado.tarjetas)) return;

    tarjetas = guardado.tarjetas.filter(function (t) {
      return t && typeof t === 'object';
    }).map(function (t) {
      var items = itemsValidos(t.items);
      // La columna guardada tiene que existir en el tablero actual.
      var columna = getColumna(t.columna) ? t.columna : primeraColumna();
      return {
        id: t.id || window.Utils.uid(),
        folio: (t.folio === '' || t.folio == null) ? '1' : String(t.folio),
        fecha: t.fecha == null ? '' : String(t.fecha),
        cliente: t.cliente == null ? '' : String(t.cliente),
        notas: t.notas == null ? '' : String(t.notas),
        items: items,
        unidades: unidadesDe(items),   // se recalculan: siempre cuadran con las líneas
        total: totalDe(items),
        columna: columna,
        creada: t.creada == null ? ahoraISO() : String(t.creada),
        movida: t.movida == null ? String(t.creada || ahoraISO()) : String(t.movida)
      };
    });
  }

  cargar();

  /* ---------------------------- Lectura ---------------------------- */

  // Devuelve copias profundas: nadie de fuera puede alterar el tablero.
  // Sin argumento devuelve todas las tarjetas (más recientes primero).
  function getTarjetas(columna) {
    var lista = columna
      ? tarjetas.filter(function (t) { return t.columna === columna; })
      : tarjetas.slice();
    return clone(lista);
  }

  function getTarjeta(id) {
    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].id === id) return clone(tarjetas[i]);
    }
    return null;
  }

  // Cantidad de tarjetas por columna: { cotizacion: 0, trabajo: 0, realizado: 0 }
  function contar() {
    var cuenta = {};
    COLUMNAS.forEach(function (col) { cuenta[col.id] = 0; });
    tarjetas.forEach(function (t) { cuenta[t.columna] += 1; });
    return cuenta;
  }

  // Folio que sigue según el tablero. Sirve para que el carrito nuevo nunca
  // repita un folio ya enviado (aunque se borre el almacenamiento del navegador).
  function siguienteFolio() {
    var max = 0;
    tarjetas.forEach(function (t) {
      var n = parseInt(t.folio, 10);
      if (isFinite(n) && n > max) max = n;
    });
    return String(max + 1);
  }

  /* --------------------------- Escritura --------------------------- */

  function notify() {
    listeners.forEach(function (fn) { fn(getTarjetas()); });
  }

  // Posición donde debe entrar una tarjeta para quedar ARRIBA de su columna.
  function indiceArribaDe(columna) {
    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].columna === columna) return i;
    }
    return tarjetas.length;
  }

  // Guarda una cotización enviada. Recibe { meta, items } del carrito.
  // Devuelve la tarjeta creada (o null si no hay nada que guardar).
  function add(fuente) {
    fuente = fuente || {};
    var meta = fuente.meta || {};
    var items = itemsValidos(fuente.items);
    if (!items.length) return null;

    var sello = ahoraISO();
    var tarjeta = {
      id: window.Utils.uid(),
      folio: (meta.folio === '' || meta.folio == null) ? '1' : String(meta.folio),
      fecha: meta.fecha == null ? '' : String(meta.fecha),
      cliente: meta.cliente == null ? '' : String(meta.cliente),
      notas: meta.notas == null ? '' : String(meta.notas),
      items: items,
      unidades: unidadesDe(items),
      total: totalDe(items),
      columna: primeraColumna(),
      creada: sello,
      movida: sello
    };

    tarjetas.unshift(tarjeta);   // la más reciente hasta arriba
    persist();
    notify();
    return clone(tarjeta);
  }

  // Mueve una tarjeta a otra columna. Devuelve la tarjeta ya movida, o null si
  // no existe, la columna no es válida o ya estaba en esa columna.
  function mover(id, columna) {
    var destino = getColumna(columna);
    if (!destino) return null;

    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].id !== id) continue;

      var t = tarjetas[i];
      if (t.columna === destino.id) return null;   // ya está ahí: nada que hacer

      tarjetas.splice(i, 1);
      t.columna = destino.id;
      t.movida = ahoraISO();
      tarjetas.splice(indiceArribaDe(destino.id), 0, t);   // entra arriba de su columna

      persist();
      notify();
      return clone(t);
    }
    return null;
  }

  function remove(id) {
    var antes = tarjetas.length;
    tarjetas = tarjetas.filter(function (t) { return t.id !== id; });
    if (tarjetas.length === antes) return false;
    persist();
    notify();
    return true;
  }

  // Permite que las vistas reaccionen a cambios del tablero.
  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  window.Proceso = {
    STORAGE_KEY: STORAGE_KEY,
    COLUMNAS: clone(COLUMNAS),
    getColumna: getColumna,
    indiceColumna: indiceColumna,
    getTarjetas: getTarjetas,
    getTarjeta: getTarjeta,
    contar: contar,
    siguienteFolio: siguienteFolio,
    add: add,
    mover: mover,
    remove: remove,
    subscribe: subscribe
  };
})();
