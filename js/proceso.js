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
 * Los tildes del taller también viajan con la tarjeta (`basesListas` y
 * `teclasListas`): qué tandas del desglose ya se imprimieron, para no repetir una
 * tanda hecha ni dejar pasar la que falta. Se tildan desde la propia tarjeta
 * (Proceso.cambiarListas) y, como el pago, no mueven la tarjeta de columna.
 *
 * El ORDEN de cada columna vive en `posicion` (la misma columna de la base: ver
 * api/functions/api.js). Una cotización NUEVA entra arriba de «Cotización» —es la
 * que se acaba de mandar— y todo lo que llega por un CAMBIO de columna entra ABAJO,
 * así los trabajos viejos quedan arriba y los nuevos abajo. Reordenar a mano
 * (arrastrar y soltar en la vista) se manda como el número del hueco donde la
 * soltaron: Proceso.reordenar.
 *
 * Mientras hay una tarjeta en la mano el tablero se congela (Proceso.arrastrando):
 * ni el sondeo de cada 15 s ni un repintado le mueven el piso.
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
  //             columna, pagado, basesListas, teclasListas, creada, movida }
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

  // Cuánto se separan dos posiciones vecinas: el mismo paso que usa el servidor (ver
  // PASO_POSICION en api/functions/api.js). Reordenar toma el punto medio del hueco.
  var PASO_POSICION = 1000;

  // ¿Hay una tarjeta en la mano? Lo prende y lo apaga la vista (arrastrar y soltar).
  // Mientras dure, el tablero no se repinta ni se sondea (ver ocupado y recargar).
  var arrastrando = false;

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

  // La posición con la que el servidor ordena cada columna (ver api/functions/api.js).
  // Si un cliente viejo —o una base que todavía no la tuviera— manda cualquier cosa sin
  // número, se cae a 0: es un número válido y ordena igual.
  function numeroPosicion(valor) {
    var n = Number(valor);
    return isFinite(n) ? n : 0;
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
      posicion: numeroPosicion(fila.posicion),
      pagado: !!fila.pagado,
      // Los tildes del taller: qué tandas del desglose ya están hechas (bases del
      // clicker y teclas con su letra). Son del tablero, no de la hoja: una base
      // vieja que no los traiga queda sin tildar.
      basesListas: !!fila.basesListas,
      teclasListas: !!fila.teclasListas,
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
  // Con una escritura en vuelo —o una tarjeta en la mano— no se pide nada: sería
  // pisar lo que está pasando.
  function recargar() {
    if (enVuelo || arrastrando) return Promise.resolve(false);
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

  function indiceDe(id) {
    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].id === id) return i;
    }
    return -1;
  }

  // Índice del arreglo donde debe entrar una tarjeta para quedar ABAJO de una columna:
  // detrás de la última de esa columna (al final de todo, si no tiene ninguna). El
  // arreglo se lee por columna (getTarjetas filtra), así que su orden ES el de la
  // pantalla: las posiciones del servidor lo vuelven a confirmar al recargar.
  function indiceAbajoDe(columna) {
    for (var i = tarjetas.length - 1; i >= 0; i--) {
      if (tarjetas[i].columna === columna) return i + 1;
    }
    return tarjetas.length;
  }

  // Dónde empieza una columna en el arreglo (para dejar una tarjeta primera). -1 si esa
  // columna no tiene ninguna.
  function indicePrimeroDe(columna) {
    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].columna === columna) return i;
    }
    return -1;
  }

  // Una tarjeta por id, sólo si está en esa columna: son las vecinas que mira el
  // arrastre para saber en qué hueco cayó.
  function tarjetaEn(columna, id) {
    if (!id) return null;
    for (var i = 0; i < tarjetas.length; i++) {
      if (tarjetas[i].id === id && tarjetas[i].columna === columna) return tarjetas[i];
    }
    return null;
  }

  // La POSICIÓN (el número, no el índice) para entrar abajo de una columna: detrás de la
  // última. Es la misma cuenta que hace el servidor cuando no se le manda `posicion`
  // (posicionAbajoDe en api/functions/api.js): columna vacía en 1000, y un `max` que
  // puede ser negativo. Así lo que se ve al instante coincide con lo que queda guardado.
  function posicionAbajoDe(columna) {
    var maxima = null;
    tarjetas.forEach(function (t) {
      if (t.columna === columna && (maxima === null || t.posicion > maxima)) maxima = t.posicion;
    });
    return (maxima === null ? 0 : maxima) + PASO_POSICION;
  }

  // La posición del hueco entre dos vecinas: el punto medio. Al principio o al final de
  // la columna, un paso afuera. Con las dos vecinas en el mismo número —no pasa con las
  // que pone el servidor, pero por si acaso— la tarjeta se corre apenas a la derecha.
  function posicionEntre(antes, despues) {
    if (!antes && !despues) return PASO_POSICION;
    if (!antes) return despues.posicion - PASO_POSICION;
    if (!despues) return antes.posicion + PASO_POSICION;
    var medio = (antes.posicion + despues.posicion) / 2;
    return (medio > antes.posicion && medio < despues.posicion)
      ? medio
      : antes.posicion + PASO_POSICION / 1000;
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

  // Guarda la edición de una tarjeta: reemplaza sus líneas y sus datos (fecha,
  // cliente, notas) con lo que quedó en el carrito. No la mueve ni le cambia el
  // folio. Recibe { meta, items } y devuelve una promesa con la tarjeta ya guardada.
  // A diferencia de mover(), no se pinta antes: el servidor puede destildar lo
  // fabricado, así que se adopta lo que confirma.
  function editar(id, fuente) {
    fuente = fuente || {};
    var items = itemsValidos(fuente.items);
    if (!items.length) return Promise.reject(new Error('La cotización no puede quedar sin productos.'));

    enVuelo++;
    return window.Api.editarCotizacion(id, { meta: fuente.meta || {}, items: items }).then(function (datos) {
      var tarjeta = sanearTarjeta(datos.cotizacion);
      var i = indiceDe(id);
      if (i >= 0) tarjetas[i] = tarjeta; else tarjetas.unshift(tarjeta);
      terminar();
      notify();
      return tarjeta;
    }, function (error) {
      terminar();
      throw error;
    });
  }

  // Mueve una tarjeta a otra columna: entra ABAJO de la destino (los trabajos viejos
  // quedan arriba y los nuevos abajo). Devuelve la tarjeta ya movida, o null si no
  // existe, la columna no es válida o ya estaba en esa columna.
  // Al entrar a «Entregado» el pago se tilda solo (el servidor hace lo mismo).
  // Se pinta primero y se manda después: si el servidor rechaza el cambio, el
  // tablero vuelve a como estaba y se avisa (sin `posicion`: la pone el servidor).
  function mover(id, columna) {
    var destino = getColumna(columna);
    if (!destino) return null;

    var antes = indiceDe(id);
    if (antes < 0 || tarjetas[antes].columna === destino.id) return null;   // ya está ahí

    var respaldo = clone(tarjetas);
    var t = tarjetas.splice(antes, 1)[0];
    t.columna = destino.id;
    t.posicion = posicionAbajoDe(destino.id);   // el número que le va a poner el servidor
    t.movida = ahoraISO();
    if (esEntregado(destino.id)) t.pagado = true;
    tarjetas.splice(indiceAbajoDe(destino.id), 0, t);   // entra abajo de su columna
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

  // Pone una tarjeta en el hueco que queda entre dos vecinas: es lo que hace arrastrar y
  // soltar. `antes` y `despues` son los ids de las tarjetas que la van a rodear en esa
  // columna (null = al principio o al final). La posición es el punto medio del hueco, así
  // que reordenar no renumera nada y dos arrastres seguidos al mismo lugar siguen entrando.
  // Devuelve la tarjeta ya puesta, o null si no había nada que hacer (mismo lugar).
  // Igual que mover(): se pinta al instante y, si el servidor falla, se vuelve atrás.
  function reordenar(id, columna, antes, despues) {
    var destino = getColumna(columna);
    if (!destino) return null;

    var i = indiceDe(id);
    if (i < 0) return null;

    var vecinaAntes = tarjetaEn(destino.id, antes);
    var vecinaDespues = tarjetaEn(destino.id, despues);
    var nueva = posicionEntre(vecinaAntes, vecinaDespues);
    if (tarjetas[i].columna === destino.id && tarjetas[i].posicion === nueva) return null;

    var respaldo = clone(tarjetas);
    var t = tarjetas.splice(i, 1)[0];
    t.columna = destino.id;
    t.posicion = nueva;
    t.movida = ahoraISO();
    if (esEntregado(destino.id)) t.pagado = true;
    // Se mete justo detrás de su vecina de arriba; sin vecina de arriba, al principio de la
    // columna (o al final de todo, si la columna quedó vacía).
    var j = vecinaAntes ? indiceDe(vecinaAntes.id) + 1 : indicePrimeroDe(destino.id);
    tarjetas.splice(j < 0 ? tarjetas.length : j, 0, t);
    notify();

    enVuelo++;
    window.Api.reordenarCotizacion(id, destino.id, nueva).then(function (datos) {
      if (datos && datos.cotizacion) {
        var k = indiceDe(id);
        if (k >= 0) tarjetas[k] = sanearTarjeta(datos.cotizacion);
      }
      terminar();
    }, function (error) {
      tarjetas = respaldo;
      notify();
      terminar();
      window.App.toast('No se pudo guardar el orden: ' + error.message, 'error');
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

  // Tilda lo que el taller ya hizo de una tarjeta: las bases del clicker y las teclas
  // con su letra (`{ bases, teclas }`, las dos casillas del desglose). Sin mover la
  // tarjeta de columna, igual que cambiarPagado(): se pinta al instante, se manda por
  // atrás y, si el servidor falla, el tablero vuelve a como estaba y se avisa.
  // Las dos banderas viajan juntas —es lo que se ve en la tarjeta— y si ninguna cambió
  // no se llama al servidor: no hay nada que guardar. Devuelve true si cambió algo.
  function cambiarListas(id, listas) {
    var i = indiceDe(id);
    if (i < 0) return false;
    var bases = !!(listas && listas.bases);
    var teclas = !!(listas && listas.teclas);
    if (!!tarjetas[i].basesListas === bases && !!tarjetas[i].teclasListas === teclas) return false;

    var respaldo = clone(tarjetas);
    tarjetas[i].basesListas = bases;
    tarjetas[i].teclasListas = teclas;
    tarjetas[i].movida = ahoraISO();
    notify();

    enVuelo++;
    window.Api.cambiarListas(id, { bases: bases, teclas: teclas }).then(function (datos) {
      if (datos && datos.cotizacion) {
        var j = indiceDe(id);
        if (j >= 0) tarjetas[j] = sanearTarjeta(datos.cotizacion);
      }
      terminar();
    }, function (error) {
      tarjetas = respaldo;
      notify();
      terminar();
      window.App.toast('No se pudo guardar lo fabricado: ' + error.message, 'error');
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

  // ¿Hay que dejar el tablero quieto? El sondeo espera a que terminen las escrituras sin
  // confirmar y a que se suelte la tarjeta que esté en la mano (arrastrar y soltar).
  function ocupado() { return enVuelo > 0 || arrastrando; }

  // La vista avisa cuándo empieza y cuándo termina un arrastre: mientras dure, el tablero
  // no se sondea ni se repinta (si no, la tarjeta se cae de la mano).
  function marcarArrastre(activo) { arrastrando = !!activo; }

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
    editar: editar,
    mover: mover,
    reordenar: reordenar,
    arrastrando: marcarArrastre,
    cambiarPagado: cambiarPagado,
    cambiarCliente: cambiarCliente,
    cambiarListas: cambiarListas,
    remove: remove,
    subscribe: subscribe
  };
})();
