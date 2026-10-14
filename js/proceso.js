/* Tablero de proceso (Kanban) de las cotizaciones enviadas.
 * Cotización -> Trabajo -> Realizado -> Entregado.
 *
 * Las tarjetas viven en Postgres y viajan por el API: lo que se envía desde
 * cualquier navegador aparece acá (y al revés). El servidor guarda cada
 * cotización como COPIA CONGELADA dentro de la misma transacción que le da el
 * folio, así que editar el carrito después no altera nada de lo guardado.
 *
 * El pago viaja con la tarjeta (`pagado`) y se tilda solo al entrar a
 * «Entregado»; destildarlo es un clic (Proceso.cambiarPagado).
 *
 * Cada movimiento se pinta al instante y se manda al servidor por atrás; si
 * falla, el tablero vuelve a como estaba y se recarga desde la base.
 * Se expone como window.Proceso */
(function () {
  'use strict';

  // Las columnas del tablero, en orden. El orden ES el flujo de trabajo.
  var COLUMNAS = [
    { id: 'cotizacion', nombre: 'Cotización' },
    { id: 'trabajo', nombre: 'Trabajo' },
    { id: 'realizado', nombre: 'Realizado' },
    { id: 'entregado', nombre: 'Entregado' }
  ];

  // Tarjetas: { id, folio, fecha, cliente, notas, items: [...], unidades, total,
  //             columna, pagado, creada, movida }
  var tarjetas = [];
  var listeners = [];
  var folioSiguiente = 1;   // lo lleva el servidor: nunca se repite un folio
  var sello = '';           // 'actualizado' de la última carga (para no repintar de gusto)
  var enVuelo = 0;          // escrituras sin confirmar: el sondeo las espera

  // Tope del nombre del cliente: es el mismo que aplica el servidor al guardar
  // (LIMITE.cliente, en api/functions/api.js). Se corta también acá para que lo
  // que se ve en la tarjeta sea exactamente lo que quedó guardado. Lo usa el campo
  // de la vista (maxlength) para no dejar escribir de más.
  var CLIENTE_MAX = 120;

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

  // La última columna cierra el flujo: al entrar ahí el pago se tilda solo. El
  // servidor hace lo mismo (es él quien manda), pero acá se adelanta para que se
  // vea tildado en el acto.
  function esEntregado(id) { return id === COLUMNAS[COLUMNAS.length - 1].id; }

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

  // Deja una tarjeta del servidor con la misma forma que usa el frontend.
  function sanearTarjeta(fila) {
    fila = fila || {};
    var items = itemsValidos(fila.items);
    return {
      id: String(fila.id || ''),
      folio: String(fila.folio == null ? '' : fila.folio),
      fecha: String(fila.fecha || ''),
      cliente: String(fila.cliente || ''),
      notas: String(fila.notas || ''),
      items: items,
      unidades: items.length ? unidadesDe(items) : window.Utils.parseNumber(fila.unidades, 0),
      total: items.length ? totalDe(items) : window.Utils.parseNumber(fila.total, 0),
      columna: fila.columna || primeraColumna(),
      pagado: !!fila.pagado,
      creada: fila.creada || ahoraISO(),
      movida: fila.movida || fila.creada || ahoraISO(),
      creadaPor: String(fila.creadaPor || ''),
      movidaPor: String(fila.movidaPor || '')
    };
  }


  /* --------------------------- Enlace con el API --------------------------- */

  function notify() {
    listeners.forEach(function (fn) { fn(getTarjetas()); });
  }

  // Reemplaza el tablero con lo que hay en la base y avisa sólo si cambió algo.
  function aplicar(lista, actualizado) {
    var nuevas = (Array.isArray(lista) ? lista : []).map(sanearTarjeta);
    var igual = !!actualizado && actualizado === sello && nuevas.length === tarjetas.length;
    tarjetas = nuevas;
    if (actualizado) sello = actualizado;
    if (!igual) notify();
    return !igual;
  }

  // Trae el tablero de nuevo. La usa el sondeo cada 15 s y también cuando una
  // escritura falla. Es silenciosa: si no hay red, se queda con lo que tiene.
  function recargar() {
    if (enVuelo) return Promise.resolve(false);   // no se pisa una escritura en curso
    return window.Api.tablero().then(function (datos) {
      return aplicar(datos.cotizaciones, datos.actualizado);
    }, function () {
      return false;
    });
  }

  // Carga lo que vino en el bootstrap (una sola llamada trae todo).
  function init(datos) {
    datos = datos || {};
    folioSiguiente = window.Utils.parseNumber(datos.folioSiguiente, 1) || 1;
    aplicar(datos.cotizaciones, '');
  }

  /* ---------------------------- Lectura ---------------------------- */

  // Devuelve copias profundas: nadie de fuera puede alterar el tablero por
  // accidente (los objetos originales quedan protegidos).
  // Con el id de una columna (los de COLUMNAS) devuelve SÓLO las tarjetas de esa
  // columna: es lo que necesita cada columna del Kanban. Sin argumento, todas.
  function getTarjetas(columna) {
    var copia = clone(tarjetas);
    if (!columna) return copia;
    return copia.filter(function (t) { return t.columna === columna; });
  }

  function getTarjeta(id) {
    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].id === id) return clone(tarjetas[i]);
    }
    return null;
  }

  function contar() {
    var cuenta = {};
    COLUMNAS.forEach(function (c) { cuenta[c.id] = 0; });
    tarjetas.forEach(function (t) { cuenta[t.columna] += 1; });
    return cuenta;
  }

  // Folio que sigue según el servidor. Así el carrito nuevo nunca repite un
  // folio ya usado, aunque se borre el almacenamiento del navegador.
  function siguienteFolio() {
    return String(folioSiguiente);
  }

  // Posición donde debe entrar una tarjeta para quedar ARRIBA de su columna.
  function indiceArribaDe(columna) {
    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].columna === columna) return i;
    }
    return tarjetas.length;
  }

  function indiceDe(id) {
    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].id === id) return i;
    }
    return -1;
  }

  /* --------------------------- Escritura --------------------------- */

  function terminar() { enVuelo--; }

  // Guarda una cotización en la base y la pone arriba de «Cotización».
  // Recibe { clientId, meta, items } del carrito y devuelve una promesa con
  // { tarjeta, folioReasignado, folioSiguiente, repetida }.
  // El clientId hace idempotente el envío: si se reintenta (doble clic, red que
  // se corta), el servidor devuelve la misma tarjeta en vez de duplicarla.
  function crear(fuente) {
    fuente = fuente || {};
    var items = itemsValidos(fuente.items);
    if (!items.length) return Promise.reject(new Error('La cotización no tiene productos.'));

    enVuelo++;
    return window.Api.crearCotizacion({
      clientId: fuente.clientId,
      meta: fuente.meta || {},
      items: items
    }).then(function (datos) {
      var tarjeta = sanearTarjeta(datos.cotizacion);
      var repetida = indiceDe(tarjeta.id);
      if (repetida >= 0) tarjetas.splice(repetida, 1);   // reintento: no se duplica
      tarjetas.unshift(tarjeta);                         // la más reciente hasta arriba
      if (datos.folioSiguiente) {
        folioSiguiente = window.Utils.parseNumber(datos.folioSiguiente, folioSiguiente);
      }
      notify();
      return {
        tarjeta: tarjeta,
        folioReasignado: !!datos.folioReasignado,
        folioSiguiente: String(folioSiguiente),
        repetida: !!datos.repetida
      };
    }).then(function (res) {
      terminar();
      return res;
    }, function (error) {
      terminar();
      throw error;
    });
  }

  // Mueve una tarjeta a otra columna. Devuelve la tarjeta ya movida, o null si
  // no existe, la columna no es válida o ya estaba en esa columna.
  // Al entrar a «Entregado» el pago se tilda solo (el servidor hace lo mismo).
  // Se pinta primero y se manda después: si el servidor rechaza el cambio, el
  // tablero vuelve a como estaba y se avisa.
  function mover(id, columna) {
    var destino = getColumna(columna);
    if (!destino) return null;

    var antes = indiceDe(id);
    if (antes < 0 || tarjetas[antes].columna === destino.id) return null;   // ya está ahí

    var respaldo = clone(tarjetas);
    var t = tarjetas.splice(antes, 1)[0];
    t.columna = destino.id;
    t.movida = ahoraISO();
    if (esEntregado(destino.id)) t.pagado = true;
    tarjetas.splice(indiceArribaDe(destino.id), 0, t);   // entra arriba de su columna
    notify();

    enVuelo++;
    window.Api.moverCotizacion(id, destino.id).then(function (datos) {
      // La confirmación trae la posición real: se adopta sin repintar.
      if (datos && datos.cotizacion) {
        var i = indiceDe(id);
        if (i >= 0) tarjetas[i] = sanearTarjeta(datos.cotizacion);
      }
      terminar();
    }, function (error) {
      tarjetas = respaldo;
      notify();
      terminar();
      window.App.toast('No se pudo mover la tarjeta: ' + error.message, 'error');
      recargar();
    });

    return clone(t);
  }

  // Tilda o destilda «Pagado» sin mover la tarjeta. Devuelve true si cambió.
  // Igual que mover(): se pinta al instante y, si el servidor falla, se vuelve.
  function cambiarPagado(id, pagado) {
    var i = indiceDe(id);
    if (i < 0) return false;
    pagado = !!pagado;
    if (!!tarjetas[i].pagado === pagado) return false;

    var respaldo = clone(tarjetas);
    tarjetas[i].pagado = pagado;
    tarjetas[i].movida = ahoraISO();
    notify();

    enVuelo++;
    window.Api.cambiarPagado(id, pagado).then(function (datos) {
      if (datos && datos.cotizacion) {
        var j = indiceDe(id);
        if (j >= 0) tarjetas[j] = sanearTarjeta(datos.cotizacion);
      }
      terminar();
    }, function (error) {
      tarjetas = respaldo;
      notify();
      terminar();
      window.App.toast('No se pudo guardar el pago: ' + error.message, 'error');
      recargar();
    });

    return true;
  }

  // Corrige el nombre del cliente sin mover la tarjeta de columna. Devuelve true
  // si cambió algo; con el mismo nombre no llama al servidor (no hay nada que
  // guardar). Igual que cambiarPagado(): se pinta al instante y, si el servidor
  // falla, el tablero vuelve a como estaba y se avisa.
  // El sello `movida` también se mueve: es lo que hace que los demás navegadores
  // abiertos se enteren del nombre nuevo (ver leerTablero, en el API).
  function cambiarCliente(id, cliente) {
    var i = indiceDe(id);
    if (i < 0) return false;
    // Se limpia igual que el servidor: sin espacios de sobra y con su tope de
    // largo, para que lo que se vea sea lo que quede guardado.
    cliente = String(cliente == null ? '' : cliente).trim().slice(0, CLIENTE_MAX);
    if (tarjetas[i].cliente === cliente) return false;

    var respaldo = clone(tarjetas);
    tarjetas[i].cliente = cliente;
    tarjetas[i].movida = ahoraISO();
    notify();

    enVuelo++;
    window.Api.cambiarCliente(id, cliente).then(function (datos) {
      if (datos && datos.cotizacion) {
        var j = indiceDe(id);
        if (j >= 0) tarjetas[j] = sanearTarjeta(datos.cotizacion);
      }
      terminar();
    }, function (error) {
      tarjetas = respaldo;
      notify();
      terminar();
      window.App.toast('No se pudo guardar el cliente: ' + error.message, 'error');
      recargar();
    });

    return true;
  }

  // Quita una tarjeta del tablero. El servidor la marca como borrada (borrado
  // suave): sale de la vista pero la historia y la bitácora quedan en la base.
  function remove(id) {
    var antes = tarjetas.length;
    var respaldo = clone(tarjetas);
    tarjetas = tarjetas.filter(function (t) { return t.id !== id; });
    if (tarjetas.length === antes) return false;
    notify();

    enVuelo++;
    window.Api.borrarCotizacion(id).then(terminar, function (error) {
      tarjetas = respaldo;
      notify();
      terminar();
      window.App.toast('No se pudo quitar la tarjeta: ' + error.message, 'error');
    });
    return true;
  }

  // Permite que las vistas reaccionen a cambios del tablero.
  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  // ¿Hay escrituras sin confirmar? El sondeo espera a que terminen.
  function ocupado() { return enVuelo > 0; }

  window.Proceso = {
    COLUMNAS: clone(COLUMNAS),
    CLIENTE_MAX: CLIENTE_MAX,
    init: init,
    recargar: recargar,
    ocupado: ocupado,
    getColumna: getColumna,
    indiceColumna: indiceColumna,
    getTarjetas: getTarjetas,
    getTarjeta: getTarjeta,
    contar: contar,
    siguienteFolio: siguienteFolio,
    crear: crear,
    mover: mover,
    cambiarPagado: cambiarPagado,
    cambiarCliente: cambiarCliente,
    remove: remove,
    subscribe: subscribe
  };
})();
