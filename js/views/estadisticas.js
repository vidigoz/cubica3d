/* Vista de Estadísticas: lo que se fabricó y lo que se vendió.
 * Ruta: #/estadisticas. Se expone como window.Views.estadisticas
 *
 * Todo sale del tablero que ya está cargado (window.Proceso.getTarjetas()): la
 * cuenta la hace js/estadisticas.js y acá sólo se pinta. No hay ninguna llamada
 * de más al servidor y nada que se pueda desincronizar: cuando alguien del
 * taller mueve una tarjeta (o el sondeo de los 15 s trae algo nuevo), Proceso
 * avisa y esta pantalla se rehace sola.
 *
 * El desplegable de mes muestra la producción de un mes o el acumulado global.
 * El mes elegido no se pierde entre repintados, y si los números no cambiaron no
 * se toca el DOM: si no, el desplegable se cerraría solo cada 15 s, que es cada
 * vez que el tablero avisa que hay algo nuevo (mismo criterio que Configuración).
 *
 * Las ventas NO dependen del desplegable: la tabla de abajo ya muestra todos los
 * meses, así que ahí el detalle mensual está siempre a la vista. */
(function () {
  'use strict';

  var Utils = window.Utils;
  var Proceso = window.Proceso;
  var Estadisticas = window.Estadisticas;

  var rootEl = null;
  var mesElegido = 'todos';   // 'todos' (global) o el mes, en formato '2026-10'
  var firmaPrevia = null;     // lo último pintado: si no cambió, no se repinta

  var TODOS = 'todos';
  var ETIQUETA_TODOS = 'Global (todos los meses)';

  /* ------------------------------ Ayudas ------------------------------ */

  function escapar(valor) { return Utils.escapeHtml(valor); }

  // El nombre lindo de una columna del tablero ('realizado' -> 'Realizado').
  function nombreColumna(id) {
    var columnas = (Proceso && Proceso.COLUMNAS) || [];
    for (var i = 0; i < columnas.length; i++) {
      if (columnas[i].id === id) return columnas[i].nombre;
    }
    return id;
  }

  function plural(n, uno, varios) { return n === 1 ? uno : varios; }

  /* ---------------------------- Plantillas ---------------------------- */

  function headTemplate() {
    return '' +
      '<div class="page__head">' +
        '<h2 class="page__title">Estadísticas</h2>' +
      '</div>';
  }

  // Una línea del ranking: puesto, muestra, nombre, barrita, cuántas y qué parte.
  function colorTemplate(fila) {
    var hex = escapar(fila.hex || '');
    var muestra = hex
      ? '<span class="dot" style="background:' + hex + '" title="' + hex + '"></span>'
      : '<span class="dot dot--vacio" title="Sin color anotado"></span>';
    var parte = Math.round(fila.parte * 100);
    return '' +
      '<li class="estat-color">' +
        '<span class="estat-color__pos">' + fila.puesto + '</span>' +
        muestra +
        '<span class="estat-color__nombre" title="' + escapar(fila.nombre) + '">' +
          escapar(fila.nombre) + '</span>' +
        '<span class="estat-color__barra"><i style="width:' + parte + '%' +
          (hex ? ';background:' + hex : '') + '"></i></span>' +
        '<span class="estat-color__cant">' + fila.cantidad + '</span>' +
        '<span class="estat-color__parte">' + parte + '%</span>' +
      '</li>';
  }

  function coloresTemplate(colores) {
    if (!colores.length) return '<p class="estat-none">Sin piezas todavía.</p>';
    return '<ol class="estat-rank">' + colores.map(colorTemplate).join('') + '</ol>';
  }

  // La columna «por mes» de cada pieza: mes y cuántas salieron ese mes.
  function mesesTemplate(meses) {
    if (!meses.length) return '<p class="estat-none">Todavía no hay meses con piezas.</p>';
    return '<ul class="estat-meses">' + meses.map(function (m) {
      return '' +
        '<li class="estat-mes' + (m.cantidad ? '' : ' estat-mes--cero') + '">' +
          '<span class="estat-mes__nombre">' + escapar(m.etiqueta) + '</span>' +
          '<b class="estat-mes__cant">' + m.cantidad + '</b>' +
        '</li>';
    }).join('') + '</ul>';
  }

  // Una pieza (base de clicker, tecla, letra, cuerpo de llavero, nombre): cuántas
  // salieron en el período elegido, con qué colores y cómo se repartieron por mes.
  function elementoTemplate(el, elegido, etiquetaPeriodo) {
    var delMes = null;
    if (elegido !== TODOS) {
      el.meses.forEach(function (m) { if (m.mes === elegido) delMes = m; });
    }
    var cantidad = delMes ? delMes.cantidad : el.total;
    var colores = delMes ? delMes.colores : el.colores;
    var cuando = elegido === TODOS
      ? 'piezas en total'
      : 'piezas en ' + (etiquetaPeriodo || elegido);
    return '' +
      '<article class="estat-card">' +
        '<header class="estat-card__head">' +
          '<h4 class="estat-card__title">' + escapar(el.etiqueta) + '</h4>' +
          '<span class="estat-card__chip">' + escapar(el.tipo + ' · ' + el.pieza) + '</span>' +
        '</header>' +
        '<p class="estat-card__nota">' + escapar(el.nota) + '</p>' +
        '<p class="estat-card__total"><b>' + cantidad + '</b> <span>' + escapar(cuando) + '</span></p>' +
        '<h5 class="estat-card__sub">Colores</h5>' +
        coloresTemplate(colores) +
        '<h5 class="estat-card__sub">Por mes</h5>' +
        mesesTemplate(el.meses) +
      '</article>';
  }

  // El 0 del que no se entiende nada: se dice qué falta y dónde está.
  function avisoVacio(datos, tarjetas) {
    if (!tarjetas.length) {
      return '<p class="alert alert--warn">Todavía no hay ninguna cotización en el tablero. ' +
        'Cuando una llegue a <b>' + escapar(nombreColumna(Estadisticas.COLUMNA_DESDE)) +
        '</b> empieza a contar acá.</p>';
    }
    var pendientes = [];
    Proceso.COLUMNAS.forEach(function (col) {
      if (datos.columnas.indexOf(col.id) >= 0) return;
      var n = 0;
      tarjetas.forEach(function (t) {
        if (t && Utils.normalize(t.columna) === col.id) n++;
      });
      if (n) pendientes.push(n + ' en ' + col.nombre);
    });
    return '<p class="alert alert--warn">Por ahora ninguna tarjeta está de <b>' +
      escapar(nombreColumna(Estadisticas.COLUMNA_DESDE)) + '</b> en adelante, así que todavía no hay ' +
      'piezas fabricadas que contar' +
      (pendientes.length ? ' (hay ' + escapar(pendientes.join(' y ')) + ').' : '.') + '</p>';
  }

  function seccionProduccion(datos, tarjetas) {
    var opciones = '<option value="' + TODOS + '"' +
      (mesElegido === TODOS ? ' selected' : '') + '>' + escapar(ETIQUETA_TODOS) + '</option>';
    var etiquetaPeriodo = '';
    datos.meses.forEach(function (m) {
      opciones += '<option value="' + escapar(m.mes) + '"' +
        (m.mes === mesElegido ? ' selected' : '') + '>' + escapar(m.etiqueta) + '</option>';
      if (m.mes === mesElegido) etiquetaPeriodo = m.etiqueta;
    });

    var columnas = (datos.columnas || []).map(nombreColumna).join(', ');
    var cuenta = datos.cuenta;
    var sinReceta = cuenta.sinReceta
      ? '<p class="estat-aviso">' + cuenta.sinReceta + ' ' +
        plural(cuenta.sinReceta, 'clicker', 'clickers') + ' viejo' +
        plural(cuenta.sinReceta, '', 's') + ' sin la receta de piezas: no se ' +
        plural(cuenta.sinReceta, 'cuenta', 'cuentan') + ' acá. Abrilo en Productos, revisá las ' +
        'teclas y las letras, y volvé a guardar la cotización.</p>'
      : '';

    return '' +
      '<section class="panel" id="estat-produccion">' +
        '<div class="page__head page__head--row">' +
          '<div class="estat-head">' +
            '<h3 class="panel__title">Producción</h3>' +
            '<p class="panel__hint">Piezas contadas en las tarjetas que están en ' +
              (columnas ? '<b>' + escapar(columnas) + '</b>' : 'ninguna columna') + '.</p>' +
          '</div>' +
          (datos.meses.length
            ? '<label class="field estat-mes-sel">' +
                '<span class="field__label">Mes</span>' +
                '<select class="field__input" id="estat-mes">' + opciones + '</select>' +
              '</label>'
            : '') +
        '</div>' +
        '<p class="estat-resumen">' +
          '<b>' + cuenta.tarjetas + '</b> ' + plural(cuenta.tarjetas, 'tarjeta', 'tarjetas') +
          ' contadas · <b>' + cuenta.unidades + '</b> ' +
          plural(cuenta.unidades, 'unidad', 'unidades') +
          (etiquetaPeriodo ? ' · mes de <b>' + escapar(etiquetaPeriodo) + '</b>' : '') +
        '</p>' +
        sinReceta +
        (datos.vacia ? avisoVacio(datos, tarjetas) : '') +
        '<div class="estat-grid">' + datos.elementos.map(function (el) {
          return elementoTemplate(el, mesElegido, etiquetaPeriodo);
        }).join('') + '</div>' +
      '</section>';
  }


  function seccionVentas(datos) {
    var ventas = datos.ventas;
    var mejor = ventas.mejor && ventas.mejor.total > 0 ? ventas.mejor : null;

    var filas = ventas.meses.map(function (m) {
      var esMejor = !!mejor && m.mes === mejor.mes;
      return '' +
        '<tr' + (esMejor ? ' class="estat-tabla__fila--mejor"' : '') + '>' +
          '<td>' + escapar(m.etiqueta) +
            (esMejor ? ' <span class="estat-tabla__pin">mejor mes</span>' : '') + '</td>' +
          '<td>' + m.tarjetas + '</td>' +
          '<td>' + m.unidades + '</td>' +
          '<td class="estat-tabla__plata">' + Utils.formatMoney(m.total) + '</td>' +
        '</tr>';
    }).join('');

    var tabla = ventas.meses.length
      ? '<div class="estat-tabla-wrap"><table class="estat-tabla">' +
          '<thead><tr>' +
            '<th>Mes</th><th>Tarjetas</th><th>Unidades</th>' +
            '<th class="estat-tabla__plata">Vendido</th>' +
          '</tr></thead>' +
          '<tbody>' + filas + '</tbody>' +
          '<tfoot><tr>' +
            '<td>Total</td><td>' + ventas.tarjetas + '</td><td>' + ventas.unidades + '</td>' +
            '<td class="estat-tabla__plata">' + Utils.formatMoney(ventas.total) + '</td>' +
          '</tr></tfoot>' +
        '</table></div>'
      : '<p class="estat-none">Todavía no hay ninguna tarjeta con «Pagado» tildado. ' +
        'El tilde se pone solo al pasar la tarjeta a <b>Entregado</b>, y se puede tildar a mano.</p>';

    return '' +
      '<section class="panel" id="estat-ventas">' +
        '<h3 class="panel__title">Ventas</h3>' +
        '<p class="panel__hint">Todas las tarjetas con <b>Pagado</b> tildado, en la columna que ' +
          'estén: es el tilde el que dice que se cobró, no la columna.</p>' +
        '<div class="estat-cifras">' +
          cifraTemplate('Total vendido', Utils.formatMoney(ventas.total), 'estat-cifra--plata') +
          cifraTemplate('Tarjetas pagadas', String(ventas.tarjetas)) +
          cifraTemplate('Unidades vendidas', String(ventas.unidades)) +
          cifraTemplate('Mejor mes', mejor ? mejor.etiqueta : '—') +
        '</div>' +
        tabla +
      '</section>';
  }

  function cifraTemplate(etiqueta, valor, clase) {
    return '' +
      '<div class="estat-cifra' + (clase ? ' ' + clase : '') + '">' +
        '<span class="estat-cifra__label">' + escapar(etiqueta) + '</span>' +
        '<b class="estat-cifra__valor">' + escapar(valor) + '</b>' +
      '</div>';
  }

  /* ------------------------------- Render ------------------------------- */

  // Cuántas tarjetas hay en cada columna: entra en la firma para que el aviso de
  // «todavía no hay nada fabricado» se actualice cuando una tarjeta se mueve.
  function firmaColumnas(tarjetas) {
    return (Proceso.COLUMNAS || []).map(function (col) {
      var n = 0;
      tarjetas.forEach(function (t) {
        if (t && Utils.normalize(t.columna) === col.id) n++;
      });
      return col.id + ':' + n;
    }).join(',');
  }

  function render(container) {
    if (container) rootEl = container;
    if (!rootEl) return;

    if (!Estadisticas) {
      rootEl.innerHTML = '<p class="alert alert--warn">No se pudo cargar el conteo de ' +
        'estadísticas. Actualizá la página con Ctrl+F5 (o Cmd+Shift+R).</p>';
      return;
    }

    var tarjetas = Proceso.getTarjetas() || [];
    var datos = Estadisticas.leer(tarjetas);

    // Si el mes elegido ya no existe, se vuelve a global: mejor eso que un
    // desplegable mostrando un mes que ya no está en la lista.
    if (mesElegido !== TODOS && !datos.meses.some(function (m) { return m.mes === mesElegido; })) {
      mesElegido = TODOS;
    }

    // Si nada cambió no se toca el DOM (si no, el desplegable se cerraría solo
    // cada vez que el sondeo del tablero avisa).
    var firma = JSON.stringify(datos) + '#' + mesElegido + '#' + firmaColumnas(tarjetas);
    if (firma === firmaPrevia && rootEl.firstChild) return;
    firmaPrevia = firma;

    rootEl.innerHTML = headTemplate() + seccionProduccion(datos, tarjetas) + seccionVentas(datos);
    enganchar();
  }

  function enganchar() {
    var select = rootEl.querySelector('#estat-mes');
    if (!select) return;
    select.addEventListener('change', function () {
      mesElegido = select.value || TODOS;
      // A propósito sin re-render previo: cambiar el mes cambia la firma, así
      // que render() vuelve a pintar con el mes nuevo.
      render();
    });
  }

  /* Proceso avisa cada vez que hay algo nuevo en el tablero (y el sondeo de los
   * 15 s también): esta pantalla se rehace sola, pero sólo si está a la vista. */
  if (Proceso && Proceso.subscribe) {
    Proceso.subscribe(function () {
      if (rootEl && rootEl.querySelector('#estat-produccion')) render();
    });
  }

  window.Views = window.Views || {};
  window.Views.estadisticas = { render: render };
})();

