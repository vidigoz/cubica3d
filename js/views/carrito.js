/* Vista del carrito: desglose de la cotización, datos del cliente y exportar PDF.
 * Ruta: #/carrito. Se expone como window.Views.carrito */
(function () {
  'use strict';

  var Utils = window.Utils;
  var Cart = window.Cart;
  var PDF = window.PDF;

  var rootEl = null;
  var boundEl = null; // el contenedor de la app es siempre el mismo: se engancha una vez

  /* ---------------------------- Plantillas ---------------------------- */

  // El aviso de que se está editando una tarjeta del tablero, con su salida. Lo
  // usan esta vista y la de Productos (por eso va en window.Views).
  function edicionAviso() {
    var ed = Cart.getEdicion();
    if (!ed) return '';
    var cliente = Utils.normalize(Cart.getMeta().cliente);
    return '' +
      '<div class="edicion-aviso" role="status">' +
        '<span>✏️ Editando la cotización <b>' + Utils.escapeHtml(PDF.folioTexto(ed.folio)) + '</b>' +
          (cliente ? ' · ' + Utils.escapeHtml(cliente) : '') +
          '. Agrega o quita productos y guarda los cambios con <b>Siguiente</b>.</span>' +
        '<button class="btn btn--ghost" type="button" data-action="cancelar-edicion">Cancelar edición</button>' +
      '</div>';
  }

  // Sale de la edición sin guardar y regresa al tablero.
  function cancelarEdicion() {
    if (!window.confirm('¿Cancelar la edición? Se pierden los cambios que no hayas guardado.')) return;
    Cart.terminarEdicion();
    window.App.navigate('proceso');
    window.App.toast('Edición cancelada');
  }

  function etiquetaEnviar() {
    return Cart.getEdicion() ? 'Guardar cambios' : 'Enviar cotización';
  }

  function headTemplate() {
    var ed = Cart.getEdicion();
    return '' +
      edicionAviso() +
      '<div class="page__head page__head--row">' +
        '<div>' +
          '<h2 class="page__title">' + (ed ? 'Editar cotización ' + Utils.escapeHtml(PDF.folioTexto(ed.folio)) : 'Carrito de cotización') + '</h2>' +
          '<p class="page__subtitle">' + (ed
            ? 'Revisa el desglose y corrige los datos. Al guardar, la tarjeta de <b>Proceso</b> queda con estos cambios; no cambia de columna.'
            : 'Revisa el desglose, captura los datos del cliente y envía la cotización: se guarda en <b>Proceso</b> y se abre el PDF para mandárselo.') + '</p>' +
        '</div>' +
        '<div class="toolbar">' +
          '<button class="btn btn--ghost" type="button" data-action="back">← Volver a productos</button>' +
          (ed ? '' : '<button class="btn btn--ghost" type="button" id="carrito-limpiar">Limpiar</button>') +
          '<button class="btn btn--primary" type="button" id="carrito-enviar">' + etiquetaEnviar() + '</button>' +
          '<button class="btn btn--ghost" type="button" id="carrito-pdf">Exportar PDF</button>' +
        '</div>' +
      '</div>';
  }

  function datosTemplate(meta) {
    return '' +
      '<section class="panel">' +
        '<h3 class="panel__title">Datos de la cotización</h3>' +
        '<div class="form__row">' +
          '<label class="field">' +
            '<span class="field__label">Folio</span>' +
            '<input class="field__input" type="text" id="q-folio" value="' + Utils.escapeHtml(meta.folio) + '" autocomplete="off"' +
              (Cart.getEdicion() ? ' disabled title="El folio de una cotización ya enviada no cambia"' : '') + ' />' +
          '</label>' +
          '<label class="field">' +
            '<span class="field__label">Fecha</span>' +
            '<input class="field__input" type="date" id="q-fecha" value="' + Utils.escapeHtml(meta.fecha) + '" />' +
          '</label>' +
        '</div>' +
        '<label class="field">' +
          '<span class="field__label">Cliente</span>' +
          '<input class="field__input" type="text" id="q-cliente" placeholder="Ej. Juan Pérez" value="' + Utils.escapeHtml(meta.cliente) + '" autocomplete="off" />' +
        '</label>' +
        '<label class="field">' +
          '<span class="field__label">Notas <em class="field__opt">(opcional)</em></span>' +
          '<textarea class="field__input" id="q-notas" rows="3" placeholder="Ej. Entrega en sucursal, grabado especial, fecha límite...">' + Utils.escapeHtml(meta.notas) + '</textarea>' +
        '</label>' +
      '</section>';
  }

  function productosTemplate() {
    return '' +
      '<section class="panel">' +
        '<div class="cart__head">' +
          '<h3 class="panel__title">Productos</h3>' +
          '<span class="cart__count" id="carrito-resumen"></span>' +
        '</div>' +
        '<div id="carrito-items"></div>' +
      '</section>';
  }

  function docTemplate() {
    return '' +
      '<section class="panel panel--doc" id="carrito-doc-panel">' +
        '<div class="cart__head">' +
          '<h3 class="panel__title">Vista previa del PDF</h3>' +
          '<span class="panel__hint">Se imprime tal cual se ve aquí (hoja A4).</span>' +
        '</div>' +
        '<div class="doc-preview"><div class="doc-preview__marco" id="carrito-doc"></div></div>' +
      '</section>';
  }

  /* ---------------------------- Desglose ---------------------------- */

  function metaTagsTemplate(item) {
    return (item.detalles || []).map(function (d) {
      return '<span class="meta-tag">' + Utils.escapeHtml(d.label) + ' ' +
        Utils.marcaDetalle(d, 'dot') +
        Utils.escapeHtml(d.nombre) + '</span>';
    }).join('');
  }

  function itemsTemplate(items) {
    if (!items.length) {
      return '' +
        '<div class="empty-state">' +
          '<span class="empty-state__emoji">🛒</span>' +
          '<p>Tu carrito está vacío. Agrega productos para armar la cotización.</p>' +
          '<button class="btn btn--primary" type="button" data-action="back">Ver productos</button>' +
        '</div>';
    }

    var filas = items.map(function (item) {
      return '' +
        '<tr>' +
          '<td>' +
            '<span class="cart-line__type">' + Utils.escapeHtml(item.tipo) + '</span>' +
            '<span class="q-item__name">' + Utils.escapeHtml(item.titulo) + '</span>' +
            (item.detalles && item.detalles.length
              ? '<span class="cart-line__meta">' + metaTagsTemplate(item) + '</span>'
              : '') +
          '</td>' +
          '<td class="ta-c">' +
            '<span class="qty">' +
              '<button class="icon-btn icon-btn--qty" type="button" data-cant="' + Utils.escapeHtml(item.id) + '" data-delta="-1"' +
                (item.cantidad <= 1 ? ' disabled' : '') + ' title="Quitar una pieza">&minus;</button>' +
              '<span class="qty__value">' + item.cantidad + '</span>' +
              '<button class="icon-btn icon-btn--qty" type="button" data-cant="' + Utils.escapeHtml(item.id) + '" data-delta="1" title="Agregar una pieza">+</button>' +
            '</span>' +
          '</td>' +
          '<td class="ta-r">' + Utils.formatMoney(item.precio) + '</td>' +
          '<td class="ta-r"><b>' + Utils.formatMoney(Cart.getLineTotal(item)) + '</b></td>' +
          '<td class="ta-c">' +
            '<button class="icon-btn" type="button" data-remove="' + Utils.escapeHtml(item.id) + '" title="Quitar del carrito">✕</button>' +
          '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<table class="q-table">' +
        '<thead>' +
          '<tr>' +
            '<th>Producto</th>' +
            '<th class="ta-c">Cant.</th>' +
            '<th class="ta-r">P. unit.</th>' +
            '<th class="ta-r">Importe</th>' +
            '<th></th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + filas + '</tbody>' +
      '</table>' +
      '<div class="cart-total"><span>Total</span><strong>' + Utils.formatMoney(Cart.getTotal()) + '</strong></div>';
  }

  /* ---------------------------- Pintado ---------------------------- */

  // Repinta lo que depende del carrito. Los campos de datos NO se reconstruyen,
  // para no borrar lo que el usuario está escribiendo.
  function repaint() {
    if (!rootEl || !rootEl.querySelector('#carrito-items')) return;

    var items = Cart.getItems();

    rootEl.querySelector('#carrito-items').innerHTML = itemsTemplate(items);

    var resumen = rootEl.querySelector('#carrito-resumen');
    if (resumen) {
      var unidades = Cart.getUnidades();
      resumen.textContent = items.length
        ? unidades + (unidades === 1 ? ' pieza · ' : ' piezas · ') + Utils.formatMoney(Cart.getTotal())
        : '';
    }

    var limpiar = rootEl.querySelector('#carrito-limpiar');
    if (limpiar) limpiar.disabled = !items.length;

    var enviar = rootEl.querySelector('#carrito-enviar');
    if (enviar) enviar.disabled = !items.length;

    var pdf = rootEl.querySelector('#carrito-pdf');
    if (pdf) pdf.disabled = !items.length;

    var panelDoc = rootEl.querySelector('#carrito-doc-panel');
    if (panelDoc) panelDoc.hidden = !items.length;

    repaintDoc();
    syncDatos();
  }

  // Vuelve a dibujar la hoja A4 (es la misma que se imprime) y la encaja a lo
  // ancho de la pantalla: en el móvil la hoja de 210mm no cabe y así se ve
  // entera sin arrastrar de costado (ver PDF.encajarHoja).
  function repaintDoc() {
    if (!rootEl) return;
    var doc = rootEl.querySelector('#carrito-doc');
    if (!doc) return;
    doc.innerHTML = Cart.getCount()
      ? '<div class="doc-preview__hoja">' + PDF.documento() + '</div>'
      : '';
    if (Cart.getCount()) PDF.encajarHoja(doc);
  }

  // Refresca los campos de datos, salvo el que el usuario esté usando.
  function syncDatos() {
    if (!rootEl) return;
    var meta = Cart.getMeta();
    ['folio', 'fecha', 'cliente', 'notas'].forEach(function (clave) {
      var el = rootEl.querySelector('#q-' + clave);
      if (el && document.activeElement !== el) el.value = meta[clave];
    });
  }

  /* ------------------------- Envío al tablero ------------------------- */

  // Manda la cotización al API: queda guardada en Postgres y aparece en Proceso
  // (#/proceso), y abre el PDF para mandárselo al cliente. Después el carrito
  // arranca de cero con folio nuevo: la tarjeta es una copia congelada, así que
  // la cotización enviada ya no se puede tocar por accidente.
  function enviarCotizacion() {
    if (Cart.getEdicion()) {
      guardarEdicion();
      return;
    }
    if (!Cart.getCount()) {
      window.App.toast('Agrega productos antes de enviar', 'error');
      return;
    }

    var boton = rootEl.querySelector('#carrito-enviar');
    if (boton) {
      boton.disabled = true;
      boton.textContent = 'Enviando…';
    }

    Proceso.crear({
      clientId: Cart.getClientId(),
      meta: Cart.getMeta(),
      items: Cart.getItems()
    }).then(function (res) {
      var tarjeta = res.tarjeta;

      Cart.clear();
      // El folio del carrito sigue la numeración de la base: así nunca se repite
      // un folio ya enviado, aunque se borre el almacenamiento del navegador.
      if (res.folioSiguiente) Cart.setMeta({ folio: String(res.folioSiguiente) });

      window.App.navigate('proceso');
      // El PDF se imprime DESPUÉS de navegar: la hoja vive en #print-root, así que
      // sale igual desde el tablero y el diálogo no tapa la cotización anterior.
      if (!PDF.imprimir({ meta: tarjeta, items: tarjeta.items })) {
        window.App.toast('Cotización guardada, pero no se pudo abrir el PDF', 'error');
        return;
      }
      if (res.folioReasignado) {
        // El folio que traía el formulario ya estaba usado y la base puso otro.
        window.App.toast('Ese folio ya estaba usado: quedó como ' + PDF.folioTexto(tarjeta.folio), 'error');
        return;
      }
      window.App.toast('Cotización ' + PDF.folioTexto(tarjeta.folio) + ' guardada en Proceso', 'success');
    }).catch(function (error) {
      // No se guardó nada: el carrito queda intacto para volver a intentar.
      window.App.toast(error.message || 'No se pudo enviar la cotización', 'error');
    }).then(function () {
      if (boton) {
        boton.disabled = false;
        boton.textContent = 'Enviar cotización';
      }
    });
  }

  // Guarda lo editado sobre la misma tarjeta (mismo folio, misma columna) y
  // regresa al tablero. El borrador que había antes de editar vuelve al carrito.
  function guardarEdicion() {
    var ed = Cart.getEdicion();
    if (!ed || !Cart.getCount()) {
      window.App.toast('La cotización no puede quedar sin productos', 'error');
      return;
    }

    var boton = rootEl.querySelector('#carrito-enviar');
    if (boton) {
      boton.disabled = true;
      boton.textContent = 'Guardando…';
    }

    Proceso.editar(ed.id, { meta: Cart.getMeta(), items: Cart.getItems() }).then(function (tarjeta) {
      Cart.terminarEdicion();
      window.App.navigate('proceso');
      window.App.toast('Cotización ' + PDF.folioTexto(tarjeta.folio) + ' actualizada', 'success');
    }).catch(function (error) {
      // No se guardó nada: la edición sigue abierta para volver a intentar.
      window.App.toast(error.message || 'No se pudo guardar la cotización', 'error');
      if (boton) {
        boton.disabled = !Cart.getCount();
        boton.textContent = etiquetaEnviar();
      }
    });
  }

  /* ------------------------- Interacciones ------------------------- */

  // Listeners delegados sobre el contenedor: no hay que reengancharlos cada vez
  // que se repinta ni al volver a entrar a la ruta.
  function bind() {
    if (boundEl === rootEl) return;
    boundEl = rootEl;

    rootEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="back"]')) {
        window.App.navigate('productos');
        return;
      }

      if (e.target.closest('[data-action="cancelar-edicion"]')) {
        cancelarEdicion();
        return;
      }

      var quitar = e.target.closest('[data-remove]');
      if (quitar) {
        Cart.remove(quitar.getAttribute('data-remove'));
        return;
      }

      var cant = e.target.closest('[data-cant]');
      if (cant) {
        var id = cant.getAttribute('data-cant');
        var delta = Utils.parseNumber(cant.getAttribute('data-delta'), 0);
        var actual = null;
        Cart.getItems().forEach(function (i) { if (i.id === id) actual = i.cantidad; });
        if (actual !== null) Cart.setCantidad(id, actual + delta);
        return;
      }

      if (e.target.closest('#carrito-limpiar')) {
        if (!Cart.getCount()) return;
        Cart.clear();
        window.App.toast('Carrito vaciado');
        return;
      }

      if (e.target.closest('#carrito-enviar')) {
        enviarCotizacion();
        return;
      }

      if (e.target.closest('#carrito-pdf')) {
        if (!PDF.imprimir()) window.App.toast('Agrega productos antes de exportar', 'error');
      }
    });

    // Los datos de la cotización se guardan solos mientras se escriben.
    rootEl.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.id || el.id.indexOf('q-') !== 0) return;
      var patch = {};
      patch[el.id.slice(2)] = el.value;
      Cart.setMeta(patch);
      repaintDoc();
    });
  }

  // El carrito es compartido: si cambia (desde aquí o desde otro producto),
  // se refresca el desglose.
  Cart.subscribe(function () {
    if (rootEl && rootEl.querySelector('#carrito-items')) repaint();
  });

  function render(container) {
    if (container) rootEl = container;
    if (!rootEl) return;

    rootEl.innerHTML =
      '<div class="page">' +
        headTemplate() +
        datosTemplate(Cart.getMeta()) +
        productosTemplate() +
        docTemplate() +
      '</div>';

    bind();
    repaint();
  }

  window.Views = window.Views || {};
  window.Views.carrito = { render: render };
  window.Views.edicionAviso = edicionAviso;
  window.Views.cancelarEdicion = cancelarEdicion;
})();
