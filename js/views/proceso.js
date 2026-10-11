/* Vista de Proceso: tablero Kanban de las cotizaciones enviadas.
 * Ruta: #/proceso. Se expone como window.Views.proceso
 *
 * Las tarjetas cambian de columna (Cotización -> Trabajo -> Realizado) con los
 * botones de la propia tarjeta: «← Atrás» y «Adelante →», que además llevan el
 * nombre de la columna a la que van. No hay arrastrar y soltar: con el dedo el
 * gesto se confundía con el scroll de la página.
 * La cotización completa se ve con el botón «Ver» (PDF.ver) y se descarga con 🖨. */
(function () {
  'use strict';

  var Utils = window.Utils;
  var Proceso = window.Proceso;
  var PDF = window.PDF;
  var PO = window.PO;

  var rootEl = null;
  var boundEl = null;   // el contenedor de la app es siempre el mismo: se engancha una vez
  var abiertas = {};    // tarjetas con el detalle desplegado (sobrevive al repintado)

  /* ---------------------------- Plantillas ---------------------------- */

  function headTemplate() {
    return '' +
      '<div class="page__head">' +
        '<h2 class="page__title">Proceso</h2>' +
        '<p class="page__subtitle">Cada tarjeta es una cotización enviada. Para pasarla a la ' +
          'columna siguiente pulsa <b>Adelante &rarr;</b>, y para devolverla <b>&larr; Atrás</b>: ' +
          'los botones de la tarjeta dicen a qué columna va cada uno.</p>' +
      '</div>';
  }

  // '2026-10-09T18:20:00.000Z' -> '09/10/2026 18:20'
  function fechaHora(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  // Importe de una línea de la tarjeta (precio unitario × cantidad).
  function importeLinea(item) {
    var cantidad = Math.floor(Utils.parseNumber(item.cantidad, 1));
    if (!(cantidad > 0)) cantidad = 1;
    return Utils.parseNumber(item.precio, 0) * cantidad;
  }

  // "2× Llavero de Nombre · 3× Clicker de Nombre"
  function resumenProductos(items) {
    return items.map(function (item) {
      return item.cantidad + '\u00d7 ' + item.tipo;
    }).join(' \u00b7 ');
  }

  // Detalle completo para fabricar: qué lleva cada pieza y de qué colores.
  function lineasTemplate(items) {
    return items.map(function (item) {
      var detalles = (item.detalles || []).map(function (d) {
        return '<span class="meta-tag">' + Utils.escapeHtml(d.label) + ' ' +
          '<span class="dot" style="background:' + Utils.escapeHtml(d.hex) + '"></span>' +
          Utils.escapeHtml(d.nombre) + '</span>';
      }).join('');

      return '' +
        '<li class="t-linea">' +
          '<span class="t-linea__cant">' + item.cantidad + '\u00d7</span>' +
          '<span class="t-linea__info">' +
            '<span class="t-linea__tipo">' + Utils.escapeHtml(item.tipo) + '</span>' +
            (item.titulo
              ? '<span class="t-linea__nombre">' + Utils.escapeHtml(item.titulo) + '</span>'
              : '') +
            (detalles ? '<span class="cart-line__meta">' + detalles + '</span>' : '') +
          '</span>' +
          '<span class="t-linea__precio">' + Utils.formatMoney(importeLinea(item)) + '</span>' +
        '</li>';
    }).join('');
  }

  // Botón que mueve la tarjeta una columna: paso -1 (atrás) o +1 (adelante).
  // Lleva el nombre de la columna destino («← Cotización», «Trabajo →»), así en
  // el móvil se ve a dónde va sin adivinar, y se apaga cuando no hay a dónde ir.
  function moverBotonTemplate(indice, paso) {
    var destino = Proceso.COLUMNAS[indice + paso];
    var siguiente = paso > 0;
    var nombre = destino ? destino.nombre : (siguiente ? 'Adelante' : 'Atr\u00e1s');
    var rotulo = siguiente ? nombre + ' \u2192' : '\u2190 ' + nombre;
    var pista = destino
      ? 'Mover a ' + destino.nombre
      : 'Ya est\u00e1 en la ' + (siguiente ? '\u00faltima' : 'primera') + ' columna';

    return '<button class="btn-mover" type="button" data-mover="' +
        (siguiente ? 'siguiente' : 'anterior') + '" title="' + Utils.escapeHtml(pista) + '"' +
        (destino ? '' : ' disabled') + '>' +
        '<span class="btn-mover__texto">' + Utils.escapeHtml(rotulo) + '</span>' +
      '</button>';
  }

  // La orden de producción de una tarjeta, ya agrupada por window.PO. Sólo se
  // arma cuando la cotización salió de la columna «Cotización»: mientras está
  // ahí todavía se está cotizando y no hay nada que fabricar.
  function poDe(t) {
    if (!PO || t.columna === Proceso.COLUMNAS[0].id) return null;
    var po = PO.leer(t.items);
    return po.vacia ? null : po;
  }

  // «7 bases · 7 teclas + 7 letras · 3 llaveros · 4 grupos»: lo que hay que
  // fabricar, en corto, para verlo en la tarjeta sin abrir la hoja.
  function poResumenTexto(totales) {
    function plural(n, singular, plural_) {
      return n + ' ' + (n === 1 ? singular : plural_);
    }
    var partes = [];
    if (totales.bases) partes.push(plural(totales.bases, 'base', 'bases'));
    if (totales.teclas) {
      partes.push(plural(totales.teclas, 'tecla', 'teclas') + ' + ' +
        plural(totales.letras, 'letra', 'letras'));
    }
    if (totales.llaveros) partes.push(plural(totales.llaveros, 'llavero', 'llaveros'));
    if (totales.otros) partes.push(plural(totales.otros, 'otro producto', 'otros productos'));
    partes.push(plural(totales.grupos, 'grupo', 'grupos'));
    return partes.join(' \u00b7 ');
  }

  function tarjetaTemplate(t) {
    var indice = Proceso.indiceColumna(t.columna);
    var po = poDe(t);

    return '' +
      '<article class="tarjeta' + (t.columna === 'realizado' ? ' tarjeta--realizado' : '') + '"' +
        ' data-id="' + Utils.escapeHtml(t.id) + '" tabindex="0">' +
        '<div class="tarjeta__top">' +
          '<span class="tarjeta__folio">' + Utils.escapeHtml(PDF.folioTexto(t.folio)) + '</span>' +
          '<span class="tarjeta__total">' + Utils.formatMoney(t.total) + '</span>' +
        '</div>' +
        '<p class="tarjeta__cliente">' +
          (t.cliente
            ? Utils.escapeHtml(t.cliente)
            : '<span class="tarjeta__sin-cliente">Sin cliente</span>') +
        '</p>' +
        '<p class="tarjeta__meta">' +
          Utils.escapeHtml(PDF.fechaTexto(t.fecha)) + ' \u00b7 ' +
          t.unidades + (t.unidades === 1 ? ' pieza' : ' piezas') + ' \u00b7 ' +
          t.items.length + (t.items.length === 1 ? ' l\u00ednea' : ' l\u00edneas') +
        '</p>' +
        '<p class="tarjeta__resumen">' + Utils.escapeHtml(resumenProductos(t.items)) + '</p>' +
        (po
          ? '<p class="tarjeta__po"><b>PO:</b> ' +
              Utils.escapeHtml(poResumenTexto(po.totales)) + '</p>'
          : '') +
        '<div class="tarjeta__acciones">' +
          moverBotonTemplate(indice, -1) +
          moverBotonTemplate(indice, 1) +
          '<span class="tarjeta__iconos">' +
            (po
              ? '<button class="btn-po" type="button" data-po ' +
                  'title="Orden de producci\u00f3n: qu\u00e9 fabricar, agrupado por color y por ' +
                  'orden de colores" aria-label="Ver la orden de producci\u00f3n">PO</button>'
              : '') +
            '<button class="btn-ver" type="button" data-ver ' +
              'title="Ver la cotizaci\u00f3n completa, sin descargar nada" ' +
              'aria-label="Ver la cotizaci\u00f3n completa">' +
              '<span aria-hidden="true">\ud83d\udc41</span>Ver</button>' +
            '<button class="icon-btn icon-btn--mini" type="button" data-pdf ' +
              'title="Descargar o imprimir el PDF" aria-label="Descargar o imprimir el PDF">\ud83d\udda8</button>' +
            '<button class="icon-btn icon-btn--mini icon-btn--mini-danger" type="button" data-quitar ' +
              'title="Quitar del tablero" aria-label="Quitar del tablero">\u2715</button>' +
          '</span>' +
        '</div>' +
        '<details class="tarjeta__detalle"' + (abiertas[t.id] ? ' open' : '') + '>' +
          '<summary>Detalle para fabricar</summary>' +
          '<ul class="t-lineas">' + lineasTemplate(t.items) + '</ul>' +
          (t.notas
            ? '<p class="tarjeta__notas"><b>Notas:</b> ' + Utils.escapeHtml(t.notas) + '</p>'
            : '') +
          '<p class="tarjeta__pie">Enviada el ' + Utils.escapeHtml(fechaHora(t.creada)) +
            (t.movida !== t.creada
              ? ' \u00b7 Movida el ' + Utils.escapeHtml(fechaHora(t.movida))
              : '') +
          '</p>' +
        '</details>' +
      '</article>';
  }

  // Qué hacer para que la columna deje de estar vacía (ahora sin arrastrar nada).
  function vacioTemplate(col) {
    var indice = Proceso.indiceColumna(col.id);
    if (indice === 0) return 'Env\u00eda una cotizaci\u00f3n desde el carrito y aparecer\u00e1 aqu\u00ed.';
    return 'A\u00fan no hay ninguna: en una tarjeta de ' + Proceso.COLUMNAS[indice - 1].nombre +
      ' pulsa \u00ab' + col.nombre + ' \u2192\u00bb.';
  }

  function columnaTemplate(col) {
    var lista = Proceso.getTarjetas(col.id);
    var unidades = 0;
    var dinero = 0;
    lista.forEach(function (t) { unidades += t.unidades; dinero += t.total; });

    return '' +
      '<section class="kanban__col" data-col="' + col.id + '">' +
        '<header class="kanban__head">' +
          '<h3 class="kanban__title">' + Utils.escapeHtml(col.nombre) + '</h3>' +
          '<span class="kanban__count" title="' + lista.length + ' cotizaciones \u00b7 ' +
            unidades + ' piezas">' + lista.length + ' \u00b7 ' + Utils.formatMoney(dinero) + '</span>' +
        '</header>' +
        '<div class="kanban__body">' +
          (lista.length
            ? lista.map(tarjetaTemplate).join('')
            : '<p class="kanban__empty">' + vacioTemplate(col) + '</p>') +
        '</div>' +
      '</section>';
  }

  /* ---------------------------- Pintado ---------------------------- */

  function render(container) {
    if (container) rootEl = container;
    if (!rootEl) return;

    rootEl.innerHTML =
      '<div class="page">' +
        headTemplate() +
        '<div class="kanban" id="kanban">' +
          Proceso.COLUMNAS.map(columnaTemplate).join('') +
        '</div>' +
      '</div>';

    bind();
  }

  /* ------------------------- Interacciones ------------------------- */

  function mover(id, columna) {
    var tarjeta = Proceso.mover(id, columna);
    if (!tarjeta) return null;
    window.App.toast('Cotizaci\u00f3n ' + PDF.folioTexto(tarjeta.folio) + ' \u2192 ' +
      Proceso.getColumna(tarjeta.columna).nombre, 'success');
    return tarjeta;
  }

  // Salta una columna atrás/adelante: lo que hacen los botones de la tarjeta.
  function moverPaso(id, paso) {
    var tarjeta = Proceso.getTarjeta(id);
    if (!tarjeta) return;
    var destino = Proceso.COLUMNAS[Proceso.indiceColumna(tarjeta.columna) + paso];
    if (!destino) return;
    if (!mover(id, destino.id)) return;

    // El tablero se repinta: devolvemos el foco a la tarjeta movida.
    var el = rootEl && rootEl.querySelector('.tarjeta[data-id="' + id + '"]');
    if (el) el.focus();
  }

  // Listeners delegados sobre el contenedor: no hay que reengancharlos cada vez
  // que se repinta ni al volver a entrar a la ruta.
  function bind() {
    if (boundEl === rootEl) return;
    boundEl = rootEl;

    rootEl.addEventListener('click', function (e) {
      var tarjetaEl = e.target.closest('.tarjeta');
      if (!tarjetaEl) return;
      var id = tarjetaEl.getAttribute('data-id');

      var paso = e.target.closest('[data-mover]');
      if (paso) {
        moverPaso(id, paso.getAttribute('data-mover') === 'siguiente' ? 1 : -1);
        return;
      }

      // Ver la cotización completa en pantalla, sin descargar nada.
      if (e.target.closest('[data-ver]')) {
        var c = Proceso.getTarjeta(id);
        if (c) PDF.ver({ meta: c, items: c.items });
        return;
      }

      // La orden de producción: la hoja con lo que hay que fabricar, agrupado
      // por color (y por orden de colores). Se arma al vuelo desde la tarjeta.
      if (e.target.closest('[data-po]')) {
        var p = Proceso.getTarjeta(id);
        if (!p) return;
        PDF.verPO({
          meta: p,
          items: p.items,
          etapa: Proceso.getColumna(p.columna).nombre
        });
        return;
      }

      // Reimprime con los datos congelados de la tarjeta: no toca el carrito.
      if (e.target.closest('[data-pdf]')) {
        var t = Proceso.getTarjeta(id);
        if (!t) return;
        PDF.imprimir({ meta: t, items: t.items });
        return;
      }

      if (e.target.closest('[data-quitar]')) {
        var q = Proceso.getTarjeta(id);
        if (!q) return;
        var folio = PDF.folioTexto(q.folio);
        if (!window.confirm('\u00bfQuitar la cotizaci\u00f3n ' + folio + ' del tablero?')) return;
        Proceso.remove(id);
        window.App.toast('Cotizaci\u00f3n ' + folio + ' quitada del tablero');
      }
    });

    // El detalle desplegado no se cierra al repintar (el evento 'toggle' no
    // burbujea, por eso se escucha en fase de captura).
    rootEl.addEventListener('toggle', function (e) {
      var detalle = e.target;
      if (!detalle.classList || !detalle.classList.contains('tarjeta__detalle')) return;
      var tarjetaEl = detalle.closest('.tarjeta');
      if (tarjetaEl) abiertas[tarjetaEl.getAttribute('data-id')] = detalle.open;
    }, true);
  }

  // El tablero es compartido: si cambia (desde aquí o al enviar una cotización
  // desde el carrito) se repinta, esté o no esta vista montada.
  Proceso.subscribe(function () {
    if (rootEl && rootEl.querySelector('#kanban')) render();
  });

  window.Views = window.Views || {};
  window.Views.proceso = { render: render };
})();
