/* Vista de Productos: menú de productos (Llaveros de Nombre / Clicker de Nombre),
 * el formulario de cada producto y el carrito de cotización compartido
 * (window.Cart). Rutas: #/productos/llaveros y #/productos/clicers.
 * Se expone como window.Views.productos */
(function () {
  'use strict';

  var Utils = window.Utils;
  var Store = window.Store;
  var Cart = window.Cart;
  var Clicer = window.Clicer;

  var rootEl = null;
  var currentSub = null;   // null = menú · 'llaveros' · 'clicers' · 'charms' · 'manual' = formulario

  // Lo elegido letra por letra en el clicker, una lista por pieza (base, acabado,
  // tecla y letra), alineada con las letras del nombre (y el símbolo, si lo hay,
  // que es la última fila). Se mantiene mientras se escribe (y mientras cambia la
  // cantidad de letras) y se pierde al salir del formulario. Vacío = todavía sigue
  // a los menús «todas».
  var clicerBase = [];        // color de la base, uno por letra (y el símbolo)
  var clicerAcabados = [];    // acabado de la base (Corrugado / Liso), uno por letra
  var clicerTeclas = [];      // color de la tecla, uno por letra
  var clicerLetras = [];      // color de la letra impresa, uno por letra

  // Filas del desglose de la cotización manual: { concepto, detalle }. Se
  // mantienen mientras se escribe y se pierden al salir del formulario.
  var manualFilas = [];

  // Charm para Silla: lo elegido pieza por pieza (base y tapa de cada letra, número o
  // símbolo del texto, alineado con ellas) y los charms sueltos. Se mantiene mientras
  // se escribe y se pierde al salir del formulario.
  var charmBase = [];      // color de la base, uno por pieza
  var charmTapas = [];     // color de la tapa, uno por pieza
  var charmLista = [];     // nombres de los charms sueltos («pelota de volly»)
  // Colores usados de la cotización manual: { color (id), piezas }. Opcionales:
  // alimentan las estadísticas de colores (su propia cuenta), no el precio.
  var manualColores = [];

  // Piezas del clicker que se eligen letra por letra: cada una es un menú por
  // letra. El id es el mismo que usa js/clicer.js y el que va en los data-* de
  // cada fila; la lista de lo elegido sale de listaDeClicer().
  var PIEZAS_CLICER = ['base', 'acabado', 'tecla', 'letra'];

  function limpiarPiezasClicer() {
    clicerBase = [];
    clicerAcabados = [];
    clicerTeclas = [];
    clicerLetras = [];
  }

  function listaDeClicer(pieza) {
    return pieza === 'base' ? clicerBase
      : pieza === 'acabado' ? clicerAcabados
      : pieza === 'tecla' ? clicerTeclas
      : clicerLetras;
  }

  /* ----------------------- Editar un producto del carrito -----------------------
     Una línea del carrito sólo guarda texto y colores, no lo que se tecleó en el
     formulario. Para editarla se reconstruye: el título dice el nombre (y el
     símbolo del clicker), los detalles dicen los colores —se buscan en el stock por
     su hex y su nombre— y, en el llavero, el precio dice si llevaba apellido.
     Una línea que no se puede reconstruir (un clicker viejo) no se edita: se quita
     y se agrega de nuevo. */

  var TIPO_LLAVERO = 'Llavero de Nombre';
  var TIPO_CLICER = 'Clicker de Nombre';

  // El color del stock que corresponde a un detalle ({ nombre, hex }); null si ya no está.
  function colorDeDetalle(d) {
    var colores = Store.getConfig().colores;
    var nombre = Utils.normalize(d && d.nombre).toLowerCase();
    var hex = Utils.normalize(d && d.hex).toLowerCase();
    var i;
    for (i = 0; i < colores.length; i++) {
      if (colores[i].nombre.toLowerCase() === nombre && colores[i].hex.toLowerCase() === hex) return colores[i];
    }
    for (i = 0; i < colores.length; i++) {
      if (colores[i].nombre.toLowerCase() === nombre) return colores[i];
    }
    for (i = 0; i < colores.length; i++) {
      if (hex && colores[i].hex.toLowerCase() === hex) return colores[i];
    }
    return null;
  }

  // Id del color de un detalle; si ya no está en el stock lo anota en `faltan` y deja ''.
  function idDeDetalle(d, faltan) {
    var c = colorDeDetalle(d);
    if (!c) {
      var nombre = Utils.normalize(d && d.nombre);
      if (nombre && faltan.indexOf(nombre) < 0) faltan.push(nombre);
      return '';
    }
    return c.id;
  }

  function parsearLlavero(item) {
    var det = item.detalles || [];
    if (det.length !== 2) return null;
    var precios = Store.getConfig().precios;
    var titulo = Utils.normalize(item.titulo);
    var espacio = titulo.indexOf(' ');
    // El título es «Nombre Apellido»: el precio dice si llevaba apellido. Si no coincide
    // con ninguno (cambiaron los precios), un espacio se toma como apellido.
    var conApellido = espacio > 0 && (item.precio === precios.nombreApellido ||
      (item.precio !== precios.nombre && precios.nombre !== precios.nombreApellido));
    var faltan = [];
    return {
      sub: 'llaveros',
      nombre: conApellido ? titulo.slice(0, espacio) : titulo,
      apellido: conApellido ? titulo.slice(espacio + 1) : '',
      base: idDeDetalle(det[0], faltan),
      colorNombre: idDeDetalle(det[1], faltan),
      faltan: faltan
    };
  }

  function parsearClicer(item) {
    var det = item.detalles || [];
    var titulo = Utils.normalize(item.titulo);
    var corte = titulo.indexOf(' + ');
    var res = Clicer.letrasDe(corte < 0 ? titulo : titulo.slice(0, corte), corte < 0 ? '' : titulo.slice(corte + 3));
    // Un clicker de los que llevaban «símbolo» escrito a mano (ya no hay ese campo: el
    // emoji va en el nombre) no se puede reconstruir: se quita y se agrega de nuevo.
    if (!res.ok || res.simbolo || !window.PO.detallesDeClicer(det) || det.length !== res.letras.length * 3) return null;
    var faltan = [];
    var datos = { sub: 'clicers', nombre: res.nombre,
      base: [], acabado: [], tecla: [], letra: [], faltan: faltan };
    for (var i = 0; i < res.letras.length; i++) {
      var b = det[i * 3];
      if (Utils.normalize(b.label) !== res.letras[i] + ' · Base') return null;
      // «Azul (Corrugado)»: el color y, entre paréntesis, el acabado.
      var nombreBase = Utils.normalize(b.nombre);
      var paren = nombreBase.lastIndexOf(' (');
      var acabadoNombre = paren > 0 && nombreBase.slice(-1) === ')' ? nombreBase.slice(paren + 2, -1) : '';
      var colorBase = paren > 0 && acabadoNombre ? nombreBase.slice(0, paren) : nombreBase;
      var acabado = Clicer.acabados().filter(function (a) { return a.nombre === acabadoNombre; })[0];
      datos.base.push(idDeDetalle({ nombre: colorBase, hex: b.hex }, faltan));
      datos.acabado.push((acabado || Clicer.acabados()[0]).id);
      datos.tecla.push(idDeDetalle(det[i * 3 + 1], faltan));
      datos.letra.push(idDeDetalle(det[i * 3 + 2], faltan));
    }
    return datos;
  }

  function parsearCharm(item) {
    var res = window.Charm.piezasDe(item.titulo);
    if (!res.ok) return null;
    var det = item.detalles || [];
    var piezas = det.filter(function (d) { return d.label !== 'Charm'; });
    if (piezas.length !== res.piezas.length * 2) return null;
    var faltan = [];
    var datos = { sub: 'charms', texto: res.texto, base: [], tapa: [], faltan: faltan,
      charms: det.filter(function (d) { return d.label === 'Charm'; }).map(function (d) { return d.nombre; }) };
    for (var i = 0; i < res.piezas.length; i++) {
      var b = piezas[i * 2];
      var t = piezas[i * 2 + 1];
      if (b.label !== res.piezas[i] + ' \u00b7 Base' || t.label !== res.piezas[i] + ' \u00b7 Tapa') return null;
      datos.base.push(idDeDetalle(b, faltan));
      datos.tapa.push(idDeDetalle(t, faltan));
    }
    return datos;
  }

  function parsearManual(item) {
    var faltan = [];
    var datos = { sub: 'manual', titulo: item.titulo, precio: item.precio, cantidad: item.cantidad,
      filas: [], colores: [], faltan: faltan };
    (item.detalles || []).forEach(function (d) {
      var m = /^Color usado(?: \u00d7(\d+))?$/.exec(Utils.normalize(d.label));
      if (!m) {
        datos.filas.push({ concepto: d.label, detalle: d.nombre });
        return;
      }
      var id = idDeDetalle(d, faltan);
      if (id) datos.colores.push({ color: id, piezas: m[1] ? parseInt(m[1], 10) : 1 });
    });
    return datos;
  }

  // La línea hecha datos de formulario, o null si no se puede editar.
  function parsear(item) {
    item = item || {};
    if (item.tipo === TIPO_LLAVERO) return parsearLlavero(item);
    if (item.tipo === TIPO_CLICER) return parsearClicer(item);
    if (item.tipo === window.PO.TIPO_CHARM) return parsearCharm(item);
    if (item.tipo === window.PO.TIPO_MANUAL) return parsearManual(item);
    return null;
  }

  // La ruta del formulario que edita esta línea ('llaveros', 'clicers', 'manual'), o null.
  function subDe(item) {
    var datos = parsear(item);
    return datos ? datos.sub : null;
  }

  // Los datos de la línea que se está editando AHORA en este formulario, o null.
  function datosEnEdicion() {
    var ed = Cart.getLineaEnEdicion();
    if (!ed || ed.sub !== currentSub) return null;
    var linea = Cart.getLinea(ed.id);
    return linea ? parsear(linea) : null;
  }

  function avisoLinea() {
    var ed = Cart.getLineaEnEdicion();
    var linea = ed && ed.sub === currentSub ? Cart.getLinea(ed.id) : null;
    if (!linea) return '';
    return '' +
      '<div class="edicion-aviso" role="status">' +
        '<span>✏️ Editando <b>' + Utils.escapeHtml(linea.titulo) + '</b>. Cambia lo que necesites y pulsa <b>Guardar línea</b>.</span>' +
        '<button class="btn btn--ghost" type="button" data-action="cancelar-linea">Cancelar</button>' +
      '</div>';
  }

  function etiquetaGuardar() {
    var ed = Cart.getLineaEnEdicion();
    return ed && ed.sub === currentSub && Cart.getLinea(ed.id) ? 'Guardar línea' : 'Agregar al carrito';
  }

  // Si el formulario está editando una línea, la reemplaza (misma posición) y vuelve
  // al carrito. Devuelve true si lo hizo; false = hay que agregar como línea nueva.
  function guardarLinea(item) {
    var ed = Cart.getLineaEnEdicion();
    if (!ed || ed.sub !== currentSub) return false;
    var hecho = Cart.reemplazar(ed.id, item);
    Cart.setLineaEnEdicion(null);
    if (!hecho) return false;   // la línea ya no estaba: se agrega como nueva
    window.App.toast('Producto actualizado', 'success');
    window.App.navigate('carrito');
    return true;
  }

  // Avisa de los colores de la línea que ya no están en el stock (el menú queda en otro).
  function avisarColoresFaltantes(datos) {
    if (datos && datos.faltan && datos.faltan.length) {
      window.App.toast('Ya no hay en stock: ' + datos.faltan.join(', ') + '. Revisa ese color.', 'error');
    }
  }

  /* ---------------------------- Plantillas ---------------------------- */

  function pageHead() {
    return '' +
      window.Views.edicionAviso() +
      '<div class="page__head">' +
        '<h2 class="page__title">Productos</h2>' +
      '</div>';
  }

  function productCard(id, route, emoji, title, desc, disabled) {
    return '' +
      '<button class="product-card' + (disabled ? ' product-card--disabled' : '') + '" ' +
        'type="button" data-product="' + id + '" data-route="' + route + '"' + (disabled ? ' disabled' : '') + '>' +
        '<span class="product-card__emoji">' + emoji + '</span>' +
        '<span class="product-card__title">' + Utils.escapeHtml(title) + '</span>' +
        '<span class="product-card__desc">' + Utils.escapeHtml(desc) + '</span>' +
        (disabled
          ? '<span class="badge badge--soon">Próximamente</span>'
          : '<span class="badge">Cotizar</span>') +
      '</button>';
  }

  // Menú principal: los productos que se pueden agregar a la cotización.
  function listTemplate() {
    return '' +
      '<section class="panel">' +
        '<h3 class="panel__title">¿Qué quieres cotizar?</h3>' +
        '<p class="panel__hint">Elige un producto y agrégalo al carrito. Puedes combinar varios productos en una misma cotización; cuando esté lista la envías desde el carrito y aparece en <b>Proceso</b>.</p>' +
        '<div class="product-grid">' +
          productCard('llaveros', 'productos/llaveros', '🔑', 'Llaveros de Nombre',
            'Elige el color de la base y del nombre. Precio con o sin apellido.', false) +
          productCard('clicers', 'productos/clicers', '🖱️', 'Clicker de Nombre',
            'Cada letra con su base (color y acabado), su tecla y su letra; todo igual o letra por letra.', false) +
          productCard('charms', 'productos/charms', '🪑', 'Charm para Silla',
            'Letras, números y símbolos con base y tapa de color, más los charms que quieras.', false) +
          productCard('manual', 'productos/manual', '✍️', 'Cotización manual',
            'Para lo que no está en el menú: pones el desglose de lo que vendes y el precio a mano.', false) +
        '</div>' +
      '</section>';
  }

  function colorOptions(colores) {
    return colores.map(function (c) {
      return '<option value="' + Utils.escapeHtml(c.id) + '">' + Utils.escapeHtml(c.nombre) + '</option>';
    }).join('');
  }

  function formTemplate() {
    var config = Store.getConfig();
    var sinColores = config.colores.length === 0;
    var options = colorOptions(config.colores);
    var dis = sinColores ? ' disabled' : '';

    return '' +
      '<section class="panel">' +
        '<button class="btn btn--ghost btn--back" type="button" data-action="back">← Volver al menú</button>' +
        avisoLinea() +
        '<h3 class="panel__title">Llaveros de Nombre</h3>' +
        (sinColores
          ? '<p class="alert alert--warn">No hay colores en stock. Agrégalos en <b>⚙️ Configuración</b> (arriba a la derecha) para poder cotizar.</p>'
          : '') +
        '<form class="form" id="form-llaveros" novalidate>' +
          '<div class="form__row">' +
            '<label class="field">' +
              '<span class="field__label">Nombre</span>' +
              '<input class="field__input" type="text" id="f-nombre" placeholder="Ej. Juan" autocomplete="off" />' +
            '</label>' +
            '<label class="field">' +
              '<span class="field__label">Apellido <em class="field__opt">(opcional)</em></span>' +
              '<input class="field__input" type="text" id="f-apellido" placeholder="Ej. Pérez" autocomplete="off" />' +
            '</label>' +
          '</div>' +
          '<div class="form__row">' +
            '<div class="field">' +
              '<span class="field__label">Color de Base</span>' +
              '<div class="field__row">' +
                '<select class="field__input" id="f-color-base"' + dis + '>' + options + '</select>' +
                '<span class="swatch" id="swatch-base"></span>' +
              '</div>' +
            '</div>' +
            '<div class="field">' +
              '<span class="field__label">Color del Nombre</span>' +
              '<div class="field__row">' +
                '<select class="field__input" id="f-color-nombre"' + dis + '>' + options + '</select>' +
                '<span class="swatch" id="swatch-nombre"></span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<p class="form__error" id="form-error" hidden></p>' +
          '<div class="form__footer">' +
            '<div class="price-preview">' +
              '<span class="price-preview__label">Precio</span>' +
              '<span class="price-preview__value" id="price-value">$0.00</span>' +
            '</div>' +
            '<button class="btn btn--primary" type="submit"' + dis + '>' + etiquetaGuardar() + '</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  // Formulario del Clicker de Nombre: cada letra del nombre (y el símbolo, si lo
  // hay) lleva TRES piezas (base con su color y su acabado, tecla y letra) y cada
  // pieza lleva su color. Arriba hay un menú «todas» por pieza (el nombre entero
  // igual) y abajo una fila por letra para cambiar sólo esa letra.
  function clicerTemplate() {
    var config = Store.getConfig();
    var sinColores = config.colores.length === 0;
    var options = colorOptions(config.colores);
    var opcionesAcabado = Clicer.acabados().map(function (a) {
      return '<option value="' + Utils.escapeHtml(a.id) + '">' + Utils.escapeHtml(a.nombre) + '</option>';
    }).join('');
    var dis = sinColores ? ' disabled' : '';

    return '' +
      '<section class="panel">' +
        '<button class="btn btn--ghost btn--back" type="button" data-action="back">← Volver al menú</button>' +
        avisoLinea() +
        '<h3 class="panel__title">Clicker de Nombre</h3>' +
        (sinColores
          ? '<p class="alert alert--warn">No hay colores en stock. Agrégalos en <b>⚙️ Configuración</b> (arriba a la derecha) para poder cotizar.</p>'
          : '') +
        '<p class="panel__hint">Cada letra del nombre lleva una <b>base</b> (con su color y su acabado, corrugado o liso), una <b>tecla</b> y una <b>letra</b>. Con los menús de «todas» queda el nombre entero igual; si querés, abajo cambiás una letra suelta.</p>' +
        '<form class="form" id="form-clicer" novalidate>' +
          '<div class="form__row">' +
            '<div class="field field--grow">' +
              '<label class="field__label" for="f-clicer-nombre">Nombre <em class="field__opt">(letras, números y emojis; cada uno cuenta como una letra)</em></label>' +
              '<div class="field__row">' +
                '<input class="field__input" type="text" id="f-clicer-nombre" placeholder="Ej. Ali" autocomplete="off"' + dis + ' />' +
                // Sólo en la PC: en el celular el teclado ya trae sus emojis (ver .emoji-btn en el CSS).
                '<button class="btn btn--ghost emoji-btn" type="button" id="clicer-emoji" title="Insertar un emoji" aria-label="Insertar un emoji"' + dis + '>😀</button>' +
              '</div>' +
            '</div>' +
            '<div class="field field--grow">' +
              '<span class="field__label">Base · Acabado de todas</span>' +
              '<select class="field__input" id="f-clicer-acabado"' + dis + '>' + opcionesAcabado + '</select>' +
            '</div>' +
          '</div>' +
          '<div class="form__row form__row--tres">' +
            '<div class="field">' +
              '<span class="field__label">Base · Color de todas</span>' +
              '<div class="field__row">' +
                '<select class="field__input" id="f-clicer-base"' + dis + '>' + options + '</select>' +
                '<span class="swatch" id="swatch-clicer-base"></span>' +
              '</div>' +
            '</div>' +
            '<div class="field">' +
              '<span class="field__label">Tecla · Color de todas</span>' +
              '<div class="field__row">' +
                '<select class="field__input" id="f-clicer-tecla-todas"' + dis + '>' + options + '</select>' +
                '<span class="swatch" id="swatch-clicer-tecla"></span>' +
              '</div>' +
            '</div>' +
            '<div class="field">' +
              '<span class="field__label">Letra · Color de todas</span>' +
              '<div class="field__row">' +
                '<select class="field__input" id="f-clicer-letra-todas"' + dis + '>' + options + '</select>' +
                '<span class="swatch" id="swatch-clicer-letra"></span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="field">' +
            '<span class="field__label">Letra por letra <em class="field__opt">(base, tecla y letra de cada una)</em></span>' +
            '<div class="teclas" id="clicer-teclas"></div>' +
            '<span class="field__opt" id="clicer-cuenta"></span>' +
          '</div>' +
          '<p class="form__error" id="clicer-error" hidden></p>' +
          '<div class="form__footer">' +
            '<div class="price-preview">' +
              '<span class="price-preview__label">Precio</span>' +
              '<span class="price-preview__value" id="clicer-precio">$0.00</span>' +
              '<span class="price-preview__nota" id="clicer-nota"></span>' +
            '</div>' +
            '<button class="btn btn--primary" type="submit"' + dis + '>' + etiquetaGuardar() + '</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  // Formulario de la Cotización manual: un título, el desglose (una fila por
  // concepto), la cantidad y el precio puesto a mano.
  function manualTemplate() {
    return '' +
      '<section class="panel">' +
        '<button class="btn btn--ghost btn--back" type="button" data-action="back">← Volver al menú</button>' +
        avisoLinea() +
        '<h3 class="panel__title">Cotización manual</h3>' +
        '<p class="panel__hint">Para vender algo que no está en el menú. Escribe qué es, el desglose de lo que incluye y el precio; sale en el PDF igual que los demás productos.</p>' +
        '<form class="form" id="form-manual" novalidate>' +
          '<label class="field">' +
            '<span class="field__label">Qué se vende</span>' +
            '<input class="field__input" type="text" id="f-manual-titulo" maxlength="120" placeholder="Ej. Letrero luminoso para Café Luna" autocomplete="off" />' +
          '</label>' +
          '<div class="field">' +
            '<span class="field__label">Desglose <em class="field__opt">(opcional, una fila por concepto)</em></span>' +
            '<div class="manual-filas" id="manual-filas"></div>' +
            '<button class="btn btn--ghost" type="button" id="manual-agregar">+ Agregar concepto</button>' +
          '</div>' +
          '<div class="field">' +
            '<span class="field__label">Colores usados <em class="field__opt">(opcional: cuenta en Estad\u00edsticas, aparte de los dem\u00e1s productos)</em></span>' +
            '<div class="manual-filas" id="manual-colores"></div>' +
            '<button class="btn btn--ghost" type="button" id="manual-color-agregar"' +
              (Store.getConfig().colores.length ? '' : ' disabled title="No hay colores en stock (Configuraci\u00f3n)"') +
              '>+ Agregar color</button>' +
          '</div>' +
          '<div class="form__row">' +
            '<label class="field">' +
              '<span class="field__label">Cantidad</span>' +
              '<input class="field__input" type="number" id="f-manual-cantidad" min="1" step="1" value="1" inputmode="numeric" />' +
            '</label>' +
            '<label class="field">' +
              '<span class="field__label">Precio unitario ($)</span>' +
              '<input class="field__input" type="number" id="f-manual-precio" min="0" step="0.01" placeholder="0.00" inputmode="decimal" />' +
            '</label>' +
          '</div>' +
          '<p class="form__error" id="manual-error" hidden></p>' +
          '<div class="form__footer">' +
            '<div class="price-preview">' +
              '<span class="price-preview__label">Importe</span>' +
              '<span class="price-preview__value" id="manual-importe">$0.00</span>' +
            '</div>' +
            '<button class="btn btn--primary" type="submit">' + etiquetaGuardar() + '</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  // Formulario del Charm para Silla: el texto, los menús «todas» (base y tapa), una
  // fila por letra, número o símbolo, y la lista de charms sueltos.
  function charmTemplate() {
    var config = Store.getConfig();
    var sinColores = config.colores.length === 0;
    var options = colorOptions(config.colores);
    var dis = sinColores ? ' disabled' : '';

    return '' +
      '<section class="panel">' +
        '<button class="btn btn--ghost btn--back" type="button" data-action="back">← Volver al menú</button>' +
        avisoLinea() +
        '<h3 class="panel__title">Charm para Silla</h3>' +
        (sinColores
          ? '<p class="alert alert--warn">No hay colores en stock. Agrégalos en <b>⚙️ Configuración</b> (arriba a la derecha) para poder cotizar.</p>'
          : '') +
        '<form class="form" id="form-charm" novalidate>' +
          '<div class="field">' +
            '<label class="field__label" for="f-charm-texto">Nombre o texto <em class="field__opt">(letras, números, símbolos y emojis; los espacios no cuentan)</em></label>' +
            '<div class="field__row">' +
              '<input class="field__input" type="text" id="f-charm-texto" maxlength="80" placeholder="Ej. Alejandro Perez #11" autocomplete="off"' + dis + ' />' +
              // Sólo en la PC: en el celular el teclado ya trae sus emojis (ver .emoji-btn en el CSS).
              '<button class="btn btn--ghost emoji-btn" type="button" id="charm-emoji" title="Insertar un emoji" aria-label="Insertar un emoji"' + dis + '>😀</button>' +
            '</div>' +
          '</div>' +
          '<div class="form__row">' +
            '<div class="field">' +
              '<span class="field__label">Base · Color de todas</span>' +
              '<div class="field__row">' +
                '<select class="field__input" id="f-charm-base"' + dis + '>' + options + '</select>' +
                '<span class="swatch" id="swatch-charm-base"></span>' +
              '</div>' +
            '</div>' +
            '<div class="field">' +
              '<span class="field__label">Tapa · Color de todas</span>' +
              '<div class="field__row">' +
                '<select class="field__input" id="f-charm-tapa"' + dis + '>' + options + '</select>' +
                '<span class="swatch" id="swatch-charm-tapa"></span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="field">' +
            '<span class="field__label">Pieza por pieza <em class="field__opt">(base y tapa de cada una)</em></span>' +
            '<div class="teclas" id="charm-piezas"></div>' +
            '<span class="field__opt" id="charm-cuenta"></span>' +
          '</div>' +
          '<div class="field">' +
            '<span class="field__label">Charms <em class="field__opt">(opcional, todos los que quieras)</em></span>' +
            '<div class="manual-filas" id="charm-lista"></div>' +
            '<button class="btn btn--ghost" type="button" id="charm-agregar">+ Agregar charm</button>' +
          '</div>' +
          '<p class="form__error" id="charm-error" hidden></p>' +
          '<div class="form__footer">' +
            '<div class="price-preview">' +
              '<span class="price-preview__label">Precio</span>' +
              '<span class="price-preview__value" id="charm-precio">$0.00</span>' +
              '<span class="price-preview__nota" id="charm-nota"></span>' +
            '</div>' +
            '<button class="btn btn--primary" type="submit"' + dis + '>' + etiquetaGuardar() + '</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  function cartTemplate() {
    return '' +
      '<section class="panel">' +
        '<div class="cart__head">' +
          '<h3 class="panel__title">' + (Cart.getEdicion() ? 'Cotización en edición' : 'Carrito de cotización') + '</h3>' +
          '<div class="cart__actions">' +
            '<button class="btn btn--ghost" type="button" id="cart-detail">Siguiente →</button>' +
            (Cart.getEdicion() ? '' : '<button class="btn btn--ghost" type="button" id="cart-clear">Limpiar</button>') +
          '</div>' +
        '</div>' +
        '<div id="cart-body"></div>' +
      '</section>';
  }

  /* ---------------------------- Render ---------------------------- */

  // sub: null = menú de productos · 'llaveros' / 'clicers' = formulario del
  // producto. Se llama desde App en cada navegación (hash) y también internamente.
  function render(container, sub) {
    if (container) rootEl = container;
    // Un selector de emojis que haya quedado abierto no sigue a otra pantalla.
    if (window.EmojiPicker) window.EmojiPicker.cerrar();
    if (sub !== undefined) {
      currentSub = (sub === 'llaveros' || sub === 'clicers' || sub === 'charms' || sub === 'manual') ? sub : null;
    }

    // La línea en edición sólo vale en SU formulario: si se sale (al menú, a otro
    // producto), se olvida.
    var enEdicion = Cart.getLineaEnEdicion();
    if (enEdicion && enEdicion.sub !== currentSub) Cart.setLineaEnEdicion(null);

    var formulario = currentSub === 'llaveros' ? formTemplate()
      : currentSub === 'clicers' ? clicerTemplate()
      : currentSub === 'charms' ? charmTemplate()
      : currentSub === 'manual' ? manualTemplate()
      : listTemplate();

    rootEl.innerHTML =
      '<div class="page">' +
        pageHead() +
        formulario +
        cartTemplate() +
      '</div>';

    bind(rootEl);
    renderCart();

    var previo = datosEnEdicion();   // la línea que se edita, hecha datos de formulario

    if (currentSub === 'llaveros') {
      if (previo) {
        rootEl.querySelector('#f-nombre').value = previo.nombre;
        rootEl.querySelector('#f-apellido').value = previo.apellido;
        if (previo.base) rootEl.querySelector('#f-color-base').value = previo.base;
        if (previo.colorNombre) rootEl.querySelector('#f-color-nombre').value = previo.colorNombre;
        avisarColoresFaltantes(previo);
      }
      updateSwatches();
      updatePricePreview();
    }

    if (currentSub === 'charms') {
      limpiarPiezasCharm();        // formulario recién montado: todo con lo de «todas»
      charmLista = [];
      if (previo) {
        rootEl.querySelector('#f-charm-texto').value = previo.texto;
        if (previo.base[0]) rootEl.querySelector('#f-charm-base').value = previo.base[0];
        if (previo.tapa[0]) rootEl.querySelector('#f-charm-tapa').value = previo.tapa[0];
        charmBase = previo.base.slice();
        charmTapas = previo.tapa.slice();
        charmLista = previo.charms.slice();
        avisarColoresFaltantes(previo);
      }
      updateSwatchesCharm();
      pintarPiezasCharm();
      pintarCharms();
      updateCharmPrecio();
    }

    if (currentSub === 'manual') {
      manualFilas = previo && previo.filas.length ? previo.filas : [{ concepto: '', detalle: '' }];
      manualColores = previo ? previo.colores : [];
      if (previo) {
        rootEl.querySelector('#f-manual-titulo').value = previo.titulo;
        rootEl.querySelector('#f-manual-precio').value = previo.precio;
        rootEl.querySelector('#f-manual-cantidad').value = previo.cantidad;
        avisarColoresFaltantes(previo);
      }
      pintarFilasManual();
      pintarColoresManual();
      updateManualImporte();
    }

    if (currentSub === 'clicers') {
      limpiarPiezasClicer();       // formulario recién montado: todo con lo de «todas»
      if (previo) {
        // El nombre y los menús «todas» (los de la primera letra); lo de cada letra va
        // en las listas, y pintarTeclas() lo respeta por posición.
        rootEl.querySelector('#f-clicer-nombre').value = previo.nombre;
        [['#f-clicer-base', previo.base], ['#f-clicer-acabado', previo.acabado],
          ['#f-clicer-tecla-todas', previo.tecla], ['#f-clicer-letra-todas', previo.letra]]
          .forEach(function (par) { if (par[1][0]) rootEl.querySelector(par[0]).value = par[1][0]; });
        clicerBase = previo.base.slice();
        clicerAcabados = previo.acabado.slice();
        clicerTeclas = previo.tecla.slice();
        clicerLetras = previo.letra.slice();
        avisarColoresFaltantes(previo);
      }
      updateSwatchesClicer();
      pintarTeclas();
      updateClicerPrecio();
    }
  }

  function bind(container) {
    // Tarjetas de producto -> navegan al formulario del producto
    container.querySelectorAll('[data-product]').forEach(function (btn) {
      if (btn.disabled) return;
      btn.addEventListener('click', function () {
        window.App.navigate(btn.getAttribute('data-route'));
      });
    });

    // Salir de la edición de una tarjeta sin guardar
    var cancelar = container.querySelector('[data-action="cancelar-edicion"]');
    if (cancelar) {
      cancelar.addEventListener('click', function () {
        window.Views.cancelarEdicion();
      });
    }

    // Salir de la edición de un producto sin guardar: de vuelta al carrito
    var cancelarLinea = container.querySelector('[data-action="cancelar-linea"]');
    if (cancelarLinea) {
      cancelarLinea.addEventListener('click', function () {
        Cart.setLineaEnEdicion(null);
        window.App.navigate('carrito');
      });
    }

    // Volver al menú principal (la página con los productos)
    var back = container.querySelector('[data-action="back"]');
    if (back) {
      back.addEventListener('click', function () {
        window.App.navigate('productos');
      });
    }

    // Formulario del producto
    var form = container.querySelector('#form-llaveros');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        addToCart();
      });

      var nombre = container.querySelector('#f-nombre');
      var apellido = container.querySelector('#f-apellido');
      nombre.addEventListener('input', updatePricePreview);
      apellido.addEventListener('input', updatePricePreview);

      var baseSel = container.querySelector('#f-color-base');
      var nomSel = container.querySelector('#f-color-nombre');
      if (baseSel) baseSel.addEventListener('change', updateSwatches);
      if (nomSel) nomSel.addEventListener('change', updateSwatches);
    }

    // Formulario del charm: el texto, los menús «todas», una fila por pieza y los
    // charms sueltos.
    var charmForm = container.querySelector('#form-charm');
    if (charmForm) {
      charmForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addCharmToCart();
      });
      container.querySelector('#f-charm-texto').addEventListener('input', function () {
        pintarPiezasCharm();
        updateCharmPrecio();
      });
      container.querySelector('#charm-emoji').addEventListener('click', function () {
        window.EmojiPicker.alternar(container.querySelector('#f-charm-texto'), container.querySelector('#charm-emoji'));
      });
      // Los dos menús «todas» valen para el texto entero: al cambiar uno se olvida lo
      // elegido pieza por pieza y todas vuelven a seguirlo.
      ['#f-charm-base', '#f-charm-tapa'].forEach(function (selector) {
        container.querySelector(selector).addEventListener('change', function () {
          limpiarPiezasCharm();
          pintarPiezasCharm();
          updateSwatchesCharm();
        });
      });
      container.querySelector('#charm-piezas').addEventListener('change', function (e) {
        var sel = e.target.closest('select[data-pieza]');
        if (!sel) return;
        listaDeCharm(sel.getAttribute('data-pieza'))[Number(sel.getAttribute('data-letra'))] = sel.value;
        updateSwatchesCharm();
      });
      container.querySelector('#charm-agregar').addEventListener('click', function () {
        leerCharms();
        charmLista.push('');
        pintarCharms();
        var campos = rootEl.querySelectorAll('[data-charm-nombre]');
        if (campos.length) campos[campos.length - 1].focus();
        updateCharmPrecio();
      });
      var listaEl = container.querySelector('#charm-lista');
      listaEl.addEventListener('input', function () { leerCharms(); updateCharmPrecio(); });
      listaEl.addEventListener('click', function (e) {
        var quitar = e.target.closest('[data-charm-quitar]');
        if (!quitar) return;
        leerCharms();
        charmLista.splice(Number(quitar.getAttribute('data-charm-quitar')), 1);
        pintarCharms();
        updateCharmPrecio();
      });
    }

    // Formulario de la cotización manual: filas del desglose, cantidad y precio.
    var manualForm = container.querySelector('#form-manual');
    if (manualForm) {
      manualForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addManualToCart();
      });
      ['#f-manual-cantidad', '#f-manual-precio'].forEach(function (selector) {
        container.querySelector(selector).addEventListener('input', updateManualImporte);
      });
      container.querySelector('#manual-agregar').addEventListener('click', function () {
        leerFilasManual();
        manualFilas.push({ concepto: '', detalle: '' });
        pintarFilasManual();
        var ultima = rootEl.querySelectorAll('[data-manual-concepto]');
        if (ultima.length) ultima[ultima.length - 1].focus();
      });
      // Las filas se repintan al agregar o quitar una: el listener va en el contenedor.
      container.querySelector('#manual-filas').addEventListener('click', function (e) {
        var quitar = e.target.closest('[data-manual-quitar]');
        if (!quitar) return;
        leerFilasManual();
        manualFilas.splice(Number(quitar.getAttribute('data-manual-quitar')), 1);
        pintarFilasManual();
      });

      // Los colores usados: igual que el desglose, una fila por color.
      container.querySelector('#manual-color-agregar').addEventListener('click', function () {
        leerColoresManual();
        manualColores.push({ color: (Store.getConfig().colores[0] || {}).id || '', piezas: 1 });
        pintarColoresManual();
      });
      container.querySelector('#manual-colores').addEventListener('click', function (e) {
        var quitar = e.target.closest('[data-color-quitar]');
        if (!quitar) return;
        leerColoresManual();
        manualColores.splice(Number(quitar.getAttribute('data-color-quitar')), 1);
        pintarColoresManual();
      });
    }

    // Formulario del clicker: los menús «todas» (base con su acabado, tecla y
    // letra) y una fila por letra del nombre.
    var clicerForm = container.querySelector('#form-clicer');
    if (clicerForm) {
      clicerForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addClicerToCart();
      });

      var nombreClicer = container.querySelector('#f-clicer-nombre');
      var botonEmoji = container.querySelector('#clicer-emoji');
      if (nombreClicer && botonEmoji) {
        botonEmoji.addEventListener('click', function () {
          window.EmojiPicker.alternar(nombreClicer, botonEmoji);
        });
      }
      if (nombreClicer) {
        nombreClicer.addEventListener('input', function () {
          pintarTeclas();
          updateClicerPrecio();
        });
      }

      // Los cuatro menús «todas» valen para el nombre entero: al cambiar uno se
      // olvida lo elegido letra por letra y todas las letras vuelven a seguirlo.
      ['#f-clicer-base', '#f-clicer-acabado', '#f-clicer-tecla-todas', '#f-clicer-letra-todas']
        .forEach(function (selector) {
          var sel = container.querySelector(selector);
          if (!sel) return;
          sel.addEventListener('change', function () {
            limpiarPiezasClicer();
            pintarTeclas();
            updateSwatchesClicer();
          });
        });

      // Los menús de cada letra salen y entran con cada letra del nombre: el
      // listener va en el contenedor y se reengancha solo.
      var letrasEl = container.querySelector('#clicer-teclas');
      if (letrasEl) {
        letrasEl.addEventListener('change', function (e) {
          var sel = e.target.closest('select[data-pieza]');
          if (!sel) return;
          var i = Number(sel.getAttribute('data-letra'));
          listaDeClicer(sel.getAttribute('data-pieza'))[i] = sel.value;
          updateSwatchesClicer();
        });
      }
    }

    // Vaciar el carrito (es compartido: afecta a todos los productos)
    var clear = container.querySelector('#cart-clear');
    if (clear) {
      clear.addEventListener('click', function () {
        if (!Cart.getCount()) return;
        Cart.clear();
        window.App.toast('Carrito vaciado');
      });
    }

    // Abrir el desglose de la cotización (#/carrito): ahí se capturan los datos
    // del cliente y se exporta el PDF.
    var detail = container.querySelector('#cart-detail');
    if (detail) {
      detail.addEventListener('click', function () {
        window.App.navigate('carrito');
      });
    }
  }

  /* ---------------------------- Lógica ---------------------------- */

  function findColor(colores, id) {
    for (var i = 0; i < colores.length; i++) {
      if (colores[i].id === id) return colores[i];
    }
    return null;
  }

  function updatePricePreview() {
    if (!rootEl) return;
    var apellido = rootEl.querySelector('#f-apellido');
    var valueEl = rootEl.querySelector('#price-value');
    if (!apellido || !valueEl) return;

    var precios = Store.getConfig().precios;
    var precio = Utils.normalize(apellido.value) ? precios.nombreApellido : precios.nombre;
    valueEl.textContent = Utils.formatMoney(precio);
  }

  function updateSwatches() {
    if (!rootEl) return;
    var colores = Store.getConfig().colores;

    var baseSel = rootEl.querySelector('#f-color-base');
    var baseSw = rootEl.querySelector('#swatch-base');
    if (baseSel && baseSw) {
      var base = findColor(colores, baseSel.value);
      baseSw.style.background = base ? base.hex : '';
    }

    var nomSel = rootEl.querySelector('#f-color-nombre');
    var nomSw = rootEl.querySelector('#swatch-nombre');
    if (nomSel && nomSw) {
      var nom = findColor(colores, nomSel.value);
      nomSw.style.background = nom ? nom.hex : '';
    }
  }

  // Muestra/oculta el aviso de error de un formulario de producto. Sin selector
  // usa el del llavero; el clicer pasa '#clicer-error'.
  function showFormError(msg, selector) {
    if (!rootEl) return;
    var el = rootEl.querySelector(selector || '#form-error');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function hideFormError(selector) {
    if (!rootEl) return;
    var el = rootEl.querySelector(selector || '#form-error');
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  }

  // Agrega el llavero al carrito compartido (window.Cart).
  function addToCart() {
    if (!rootEl) return;
    var config = Store.getConfig();
    var nombre = Utils.normalize(rootEl.querySelector('#f-nombre').value);
    var apellido = Utils.normalize(rootEl.querySelector('#f-apellido').value);
    var baseSel = rootEl.querySelector('#f-color-base');
    var nomSel = rootEl.querySelector('#f-color-nombre');

    if (!nombre) {
      showFormError('Escribe al menos el nombre.');
      return;
    }

    var base = findColor(config.colores, baseSel && baseSel.value);
    var colorNombre = findColor(config.colores, nomSel && nomSel.value);
    if (!base || !colorNombre) {
      showFormError('Selecciona el color de base y el color del nombre.');
      return;
    }

    var precio = apellido ? config.precios.nombreApellido : config.precios.nombre;

    var llavero = {
      tipo: 'Llavero de Nombre',
      titulo: nombre + (apellido ? ' ' + apellido : ''),
      detalles: [
        { label: 'Base', nombre: base.nombre, hex: base.hex },
        { label: 'Nombre', nombre: colorNombre.nombre, hex: colorNombre.hex }
      ],
      precio: precio
    };
    if (guardarLinea(llavero)) return;
    Cart.add(llavero);

    hideFormError();
    rootEl.querySelector('#f-nombre').value = '';
    rootEl.querySelector('#f-apellido').value = '';
    rootEl.querySelector('#f-nombre').focus();

    updatePricePreview();
    window.App.toast('Agregado al carrito', 'success');
  }

  /* ------------------------- Charm para Silla ------------------------- */

  function listaDeCharm(pieza) { return pieza === 'base' ? charmBase : charmTapas; }

  function limpiarPiezasCharm() {
    charmBase = [];
    charmTapas = [];
  }

  // Lo que dicen los dos menús «todas»: el punto de partida de cada pieza.
  function todasCharm(config) {
    var primero = (config.colores[0] || {}).id || '';
    return { base: valorDe('#f-charm-base') || primero, tapa: valorDe('#f-charm-tapa') || primero };
  }

  // Reparte el texto en filas: una por letra, número o símbolo, con la base y la tapa
  // que le tocaron. Se vuelve a llamar con cada tecla, y cada pieza conserva lo que
  // ya tenía elegido.
  function pintarPiezasCharm() {
    if (!rootEl) return;
    var cont = rootEl.querySelector('#charm-piezas');
    if (!cont) return;

    var config = Store.getConfig();
    var res = window.Charm.piezasDe(valorDe('#f-charm-texto'));
    var cuenta = rootEl.querySelector('#charm-cuenta');

    if (!res.ok) {
      limpiarPiezasCharm();
      cont.innerHTML = '<p class="empty">' + Utils.escapeHtml(res.error) + '</p>';
      if (cuenta) cuenta.textContent = '';
      return;
    }

    var todas = todasCharm(config);
    charmBase = window.Charm.alinear(res.piezas.length, charmBase, todas.base);
    charmTapas = window.Charm.alinear(res.piezas.length, charmTapas, todas.tapa);

    var options = colorOptions(config.colores);
    var dis = config.colores.length ? '' : ' disabled';
    cont.innerHTML = res.piezas.map(function (pieza, i) {
      return '' +
        '<div class="tecla tecla--bicolor">' +
          '<span class="tecla__letra">' + Utils.escapeHtml(pieza) + '</span>' +
          piezaTemplate('base', 'Base', i, pieza, options, dis, true) +
          piezaTemplate('tapa', 'Tapa', i, pieza, options, dis, true) +
        '</div>';
    }).join('');

    res.piezas.forEach(function (_, i) {
      ['base', 'tapa'].forEach(function (pieza) {
        var sel = cont.querySelector('[data-pieza="' + pieza + '"][data-letra="' + i + '"]');
        if (sel) sel.value = listaDeCharm(pieza)[i];
      });
    });

    if (cuenta) {
      cuenta.textContent = res.piezas.length + (res.piezas.length === 1 ? ' pieza' : ' piezas') +
        ' (base y tapa de cada una)';
    }
    updateSwatchesCharm();
  }

  // Muestras de color: las de los menús «todas» y las dos de cada pieza.
  function updateSwatchesCharm() {
    if (!rootEl) return;
    var colores = Store.getConfig().colores;
    pintarSwatch(rootEl.querySelector('#swatch-charm-base'), hexDe(colores, valorDe('#f-charm-base')));
    pintarSwatch(rootEl.querySelector('#swatch-charm-tapa'), hexDe(colores, valorDe('#f-charm-tapa')));

    var cont = rootEl.querySelector('#charm-piezas');
    if (!cont) return;
    cont.querySelectorAll('[data-muestra]').forEach(function (sw) {
      var pieza = sw.getAttribute('data-muestra');
      var i = Number(sw.getAttribute('data-letra'));
      var sel = cont.querySelector('[data-pieza="' + pieza + '"][data-letra="' + i + '"]');
      pintarSwatch(sw, hexDe(colores, (sel && sel.value) || listaDeCharm(pieza)[i]));
    });
  }

  // Los charms sueltos: una fila con su nombre, que se puede quitar.
  function leerCharms() {
    if (!rootEl) return;
    charmLista = [];
    rootEl.querySelectorAll('[data-charm-nombre]').forEach(function (campo) {
      charmLista.push(campo.value);
    });
  }

  function pintarCharms() {
    var cont = rootEl && rootEl.querySelector('#charm-lista');
    if (!cont) return;
    if (!charmLista.length) {
      cont.innerHTML = '<p class="empty">Sin charms sueltos.</p>';
      return;
    }
    cont.innerHTML = charmLista.map(function (nombre, i) {
      return '' +
        '<div class="manual-fila manual-fila--charm">' +
          '<input class="field__input" type="text" data-charm-nombre maxlength="' + window.Charm.CHARM_MAX + '" ' +
            'placeholder="Ej. pelota de volly" aria-label="Charm ' + (i + 1) + '" ' +
            'value="' + Utils.escapeHtml(nombre) + '" autocomplete="off" />' +
          '<button class="icon-btn" type="button" data-charm-quitar="' + i + '" title="Quitar charm">\u2715</button>' +
        '</div>';
    }).join('');
  }

  // Los charms sueltos con nombre (las filas vacías no cuentan).
  function charmsEscritos() {
    leerCharms();
    return charmLista.map(function (n) { return Utils.normalize(n); }).filter(Boolean);
  }

  // Precio: fijo, lleve las piezas y los charms que lleve.
  function updateCharmPrecio() {
    if (!rootEl) return;
    var valor = rootEl.querySelector('#charm-precio');
    var nota = rootEl.querySelector('#charm-nota');
    if (!valor) return;
    valor.textContent = Utils.formatMoney(window.Charm.precioDe(Store.getConfig()).total);
    if (nota) nota.textContent = 'precio fijo';
  }

  // Agrega el charm al carrito compartido, con el desglose de CADA pieza (su base y su
  // tapa) y los charms sueltos.
  function addCharmToCart() {
    if (!rootEl) return;
    var config = Store.getConfig();
    var res = window.Charm.piezasDe(valorDe('#f-charm-texto'));
    if (!res.ok) {
      showFormError(res.error, '#charm-error');
      return;
    }

    var piezas = [];
    for (var i = 0; i < res.piezas.length; i++) {
      var selBase = rootEl.querySelector('[data-pieza="base"][data-letra="' + i + '"]');
      var selTapa = rootEl.querySelector('[data-pieza="tapa"][data-letra="' + i + '"]');
      var base = findColor(config.colores, (selBase && selBase.value) || charmBase[i]);
      var tapa = findColor(config.colores, (selTapa && selTapa.value) || charmTapas[i]);
      if (!base || !tapa) {
        showFormError('Elige el color de la base y de la tapa de cada pieza.', '#charm-error');
        return;
      }
      piezas.push({ caracter: res.piezas[i], base: base, tapa: tapa });
    }

    var charms = charmsEscritos();
    var item = {
      tipo: window.PO.TIPO_CHARM,
      titulo: res.texto,
      detalles: window.Charm.detallesDe(piezas, charms),
      precio: window.Charm.precioDe(config).total
    };
    if (guardarLinea(item)) return;
    Cart.add(item);

    hideFormError('#charm-error');
    var campo = rootEl.querySelector('#f-charm-texto');
    campo.value = '';
    limpiarPiezasCharm();
    charmLista = [];
    pintarPiezasCharm();
    pintarCharms();
    updateCharmPrecio();
    campo.focus();
    window.App.toast('Agregado al carrito', 'success');
  }

  /* ------------------------- Cotización manual ------------------------- */

  // Lee lo escrito en las filas del desglose y lo guarda en manualFilas.
  function leerFilasManual() {
    if (!rootEl) return;
    manualFilas = [];
    rootEl.querySelectorAll('#manual-filas .manual-fila').forEach(function (fila) {
      manualFilas.push({
        concepto: fila.querySelector('[data-manual-concepto]').value,
        detalle: fila.querySelector('[data-manual-detalle]').value
      });
    });
  }

  function pintarFilasManual() {
    var cont = rootEl && rootEl.querySelector('#manual-filas');
    if (!cont) return;
    if (!manualFilas.length) {
      cont.innerHTML = '<p class="empty">Sin desglose: en el PDF sólo saldrá el título.</p>';
      return;
    }
    cont.innerHTML = manualFilas.map(function (f, i) {
      return '' +
        '<div class="manual-fila">' +
          '<input class="field__input" type="text" data-manual-concepto maxlength="60" ' +
            'placeholder="Concepto (Ej. Diseño)" aria-label="Concepto ' + (i + 1) + '" ' +
            'value="' + Utils.escapeHtml(f.concepto) + '" autocomplete="off" />' +
          '<input class="field__input" type="text" data-manual-detalle maxlength="120" ' +
            'placeholder="Detalle (Ej. logo a dos colores)" aria-label="Detalle ' + (i + 1) + '" ' +
            'value="' + Utils.escapeHtml(f.detalle) + '" autocomplete="off" />' +
          '<button class="icon-btn" type="button" data-manual-quitar="' + i + '" title="Quitar concepto">✕</button>' +
        '</div>';
    }).join('');
  }

  function leerColoresManual() {
    if (!rootEl) return;
    manualColores = [];
    rootEl.querySelectorAll('#manual-colores .manual-fila').forEach(function (fila) {
      manualColores.push({
        color: fila.querySelector('[data-color-id]').value,
        piezas: fila.querySelector('[data-color-piezas]').value
      });
    });
  }

  function pintarColoresManual() {
    var cont = rootEl && rootEl.querySelector('#manual-colores');
    if (!cont) return;
    if (!manualColores.length) {
      cont.innerHTML = '<p class="empty">Sin colores anotados: no cuenta en las estad\u00edsticas de colores.</p>';
      return;
    }
    var options = colorOptions(Store.getConfig().colores);
    cont.innerHTML = manualColores.map(function (f, i) {
      return '' +
        '<div class="manual-fila manual-fila--color">' +
          '<span class="field__row">' +
            '<select class="field__input" data-color-id aria-label="Color usado ' + (i + 1) + '">' + options + '</select>' +
            '<span class="swatch" data-color-muestra></span>' +
          '</span>' +
          '<input class="field__input" type="number" data-color-piezas min="1" step="1" inputmode="numeric" ' +
            'aria-label="Piezas de este color" title="Piezas de este color (por unidad)" value="' + Utils.escapeHtml(f.piezas) + '" />' +
          '<button class="icon-btn" type="button" data-color-quitar="' + i + '" title="Quitar color">\u2715</button>' +
        '</div>';
    }).join('');
    cont.querySelectorAll('.manual-fila').forEach(function (fila, i) {
      var sel = fila.querySelector('[data-color-id]');
      sel.value = manualColores[i].color;
      var pintar = function () {
        var c = findColor(Store.getConfig().colores, sel.value);
        fila.querySelector('[data-color-muestra]').style.background = c ? c.hex : '';
      };
      sel.addEventListener('change', pintar);
      pintar();
    });
  }

  function updateManualImporte() {
    var el = rootEl && rootEl.querySelector('#manual-importe');
    if (!el) return;
    var cantidad = Math.floor(Utils.parseNumber(valorDe('#f-manual-cantidad'), 1));
    var precio = Math.max(0, Utils.parseNumber(valorDe('#f-manual-precio'), 0));
    el.textContent = Utils.formatMoney(precio * (cantidad > 0 ? cantidad : 1));
  }

  // Agrega la cotización manual al carrito compartido. El desglose va en los
  // detalles (concepto → label, detalle → nombre, sin color): el PDF, el carrito
  // y la tarjeta lo muestran como a los demás productos.
  function addManualToCart() {
    if (!rootEl) return;
    var titulo = Utils.normalize(valorDe('#f-manual-titulo'));
    var precioTexto = Utils.normalize(valorDe('#f-manual-precio'));
    var precio = Utils.parseNumber(precioTexto, NaN);

    if (!titulo) {
      showFormError('Escribe qué se vende.', '#manual-error');
      return;
    }
    if (!isFinite(precio) || precio < 0) {
      showFormError('Escribe el precio unitario (puede ser $0.00).', '#manual-error');
      return;
    }

    leerFilasManual();
    var detalles = manualFilas.map(function (f) {
      return { label: Utils.normalize(f.concepto), nombre: Utils.normalize(f.detalle), hex: '' };
    }).filter(function (d) { return d.label || d.nombre; });

    // Los colores usados van como detalles «Color usado» con su color: las
    // estad\u00edsticas los leen de ah\u00ed (ver PO.coloresUsados).
    leerColoresManual();
    manualColores.forEach(function (f) {
      var color = findColor(Store.getConfig().colores, f.color);
      if (!color) return;
      var piezas = Math.max(1, Math.floor(Utils.parseNumber(f.piezas, 1)));
      detalles.push({ label: window.PO.rotuloColorUsado(piezas), nombre: color.nombre, hex: color.hex });
    });

    var manual = {
      tipo: window.PO.TIPO_MANUAL,
      titulo: titulo,
      detalles: detalles,
      precio: precio,
      cantidad: valorDe('#f-manual-cantidad')
    };
    if (guardarLinea(manual)) return;
    Cart.add(manual);

    hideFormError('#manual-error');
    rootEl.querySelector('#f-manual-titulo').value = '';
    rootEl.querySelector('#f-manual-precio').value = '';
    rootEl.querySelector('#f-manual-cantidad').value = '1';
    manualFilas = [{ concepto: '', detalle: '' }];
    manualColores = [];
    pintarFilasManual();
    pintarColoresManual();
    updateManualImporte();
    rootEl.querySelector('#f-manual-titulo').focus();
    window.App.toast('Agregado al carrito', 'success');
  }

  /* ------------------------- Clicker de Nombre ------------------------- */

  // Lo que dicen los cuatro menús «todas»: el punto de partida de cada letra y
  // lo que toma una letra nueva. Con eso el nombre entero queda igual de una vez.
  function todasLasPiezas(config) {
    var primero = (config.colores[0] || {}).id || '';
    return {
      base: valorDe('#f-clicer-base') || primero,
      acabado: valorDe('#f-clicer-acabado') || (Clicer.ACABADOS[0] || {}).id || '',
      tecla: valorDe('#f-clicer-tecla-todas') || primero,
      letra: valorDe('#f-clicer-letra-todas') || primero
    };
  }

  // El valor de un control del formulario ('' si no está en pantalla).
  function valorDe(selector) {
    var el = rootEl && rootEl.querySelector(selector);
    return el ? el.value : '';
  }

  // Un menú de una pieza de una letra, con su rótulo y (si es un color) su
  // muestra. Los data-pieza / data-letra dicen a quién pertenece, así el cambio
  // se puede leer desde el contenedor. `aria` (opcional) reemplaza al rótulo
  // que anuncia el lector de pantalla.
  function piezaTemplate(pieza, rotulo, i, letra, opciones, dis, conMuestra, aria) {
    return '' +
      '<label class="tecla__campo">' +
        '<span class="tecla__rotulo">' + Utils.escapeHtml(rotulo) + '</span>' +
        '<span class="field__row">' +
          '<select class="field__input" data-pieza="' + pieza + '" data-letra="' + i + '" ' +
            'aria-label="' + Utils.escapeHtml(aria || (rotulo + ' de la ' + letra)) + '"' + dis + '>' +
            opciones +
          '</select>' +
          (conMuestra
            ? '<span class="swatch swatch--sm" data-muestra="' + pieza + '" data-letra="' + i + '"></span>'
            : '') +
        '</span>' +
      '</label>';
  }

  // Reparte el nombre en filas: una por letra (o emoji), con la base (color y
  // acabado), la tecla y la letra que le tocaron.
  // Se vuelve a llamar con cada letra que se escribe, así que cada letra conserva
  // lo que ya tenía elegido.
  function pintarTeclas() {
    if (!rootEl) return;
    var cont = rootEl.querySelector('#clicer-teclas');
    if (!cont) return;

    var config = Store.getConfig();
    var campo = rootEl.querySelector('#f-clicer-nombre');
    var res = Clicer.letrasDe(campo ? campo.value : '');
    var cuenta = rootEl.querySelector('#clicer-cuenta');

    if (!res.ok) {
      limpiarPiezasClicer();
      cont.innerHTML = '<p class="empty">' + Utils.escapeHtml(res.error) + '</p>';
      if (cuenta) cuenta.textContent = '';
      return;
    }

    // Lo elegido se conserva por posición; lo que falta toma lo de «todas».
    var todas = todasLasPiezas(config);
    var cuantas = res.letras.length;
    clicerBase = Clicer.alinear(cuantas, clicerBase, todas.base);
    clicerAcabados = Clicer.alinear(cuantas, clicerAcabados, todas.acabado);
    clicerTeclas = Clicer.alinear(cuantas, clicerTeclas, todas.tecla);
    clicerLetras = Clicer.alinear(cuantas, clicerLetras, todas.letra);

    var options = colorOptions(config.colores);
    var opcionesAcabado = Clicer.acabados().map(function (a) {
      return '<option value="' + Utils.escapeHtml(a.id) + '">' + Utils.escapeHtml(a.nombre) + '</option>';
    }).join('');
    var dis = config.colores.length ? '' : ' disabled';

    cont.innerHTML = res.letras.map(function (letra, i) {
      return '' +
        '<div class="tecla">' +
          '<span class="tecla__letra">' + Utils.escapeHtml(letra) + '</span>' +
          piezaTemplate('base', 'Base', i, letra, options, dis, true) +
          piezaTemplate('acabado', 'Acabado', i, letra, opcionesAcabado, dis, false) +
          piezaTemplate('tecla', 'Tecla', i, letra, options, dis, true) +
          piezaTemplate('letra', 'Letra', i, letra, options, dis, true) +
        '</div>';
    }).join('');

    // Cada menú queda en lo que le toca (lo elegido para esa letra o lo de «todas»).
    res.letras.forEach(function (_, i) {
      PIEZAS_CLICER.forEach(function (pieza) {
        var sel = cont.querySelector('[data-pieza="' + pieza + '"][data-letra="' + i + '"]');
        if (sel) sel.value = listaDeClicer(pieza)[i];
      });
    });

    if (cuenta) {
      var teclas = res.letras.length;
      cuenta.textContent = teclas + (teclas === 1 ? ' tecla' : ' teclas') +
        ' · ' + (teclas * 3) + ' piezas (base, tecla y letra por letra)';
    }

    updateSwatchesClicer();
  }

  // Muestras de color: las de los menús «todas» y las tres de cada letra.
  function updateSwatchesClicer() {
    if (!rootEl) return;
    var colores = Store.getConfig().colores;

    pintarSwatch(rootEl.querySelector('#swatch-clicer-base'), hexDe(colores, valorDe('#f-clicer-base')));
    pintarSwatch(rootEl.querySelector('#swatch-clicer-tecla'), hexDe(colores, valorDe('#f-clicer-tecla-todas')));
    pintarSwatch(rootEl.querySelector('#swatch-clicer-letra'), hexDe(colores, valorDe('#f-clicer-letra-todas')));

    var cont = rootEl.querySelector('#clicer-teclas');
    if (!cont) return;
    cont.querySelectorAll('[data-muestra]').forEach(function (sw) {
      var pieza = sw.getAttribute('data-muestra');
      var i = Number(sw.getAttribute('data-letra'));
      var sel = cont.querySelector('[data-pieza="' + pieza + '"][data-letra="' + i + '"]');
      pintarSwatch(sw, hexDe(colores, (sel && sel.value) || listaDeClicer(pieza)[i]));
    });
  }

  function pintarSwatch(el, hex) {
    if (el) el.style.background = hex || '';
  }

  function hexDe(colores, id) {
    var c = findColor(colores, id);
    return c ? c.hex : '';
  }

  // Precio del clicker: por letra, con el tramo corto o el largo según la
  // configuración de Configuración → Precios. Bajo el número se ve la cuenta.
  function updateClicerPrecio() {
    if (!rootEl) return;
    var valor = rootEl.querySelector('#clicer-precio');
    var nota = rootEl.querySelector('#clicer-nota');
    if (!valor) return;

    var campo = rootEl.querySelector('#f-clicer-nombre');
    var res = Clicer.letrasDe(campo ? campo.value : '');
    if (!res.ok) {
      valor.textContent = Utils.formatMoney(0);
      if (nota) nota.textContent = '';
      return;
    }

    var p = Clicer.precioDe(Store.getConfig(), res.letras.length);
    valor.textContent = Utils.formatMoney(p.total);
    if (nota) {
      nota.textContent = p.letras + (p.letras === 1 ? ' letra' : ' letras') + ' × ' +
        Utils.formatMoney(p.porLetra) + (p.largo
          ? ' (precio de ' + (p.letrasCorte + 1) + ' letras o más)'
          : ' (precio hasta ' + p.letrasCorte + ' letras)');
    }
  }

  // Agrega el clicker al carrito compartido (window.Cart), con el desglose
  // completo de CADA letra (o emoji): su base (color y acabado), su tecla y su
  // letra, que es lo que se necesita para fabricarlo.
  function addClicerToCart() {
    if (!rootEl) return;
    var config = Store.getConfig();
    var campo = rootEl.querySelector('#f-clicer-nombre');
    var res = Clicer.letrasDe(campo ? campo.value : '');
    if (!res.ok) {
      showFormError(res.error, '#clicer-error');
      return;
    }

    // Lo que quedó en cada menú: el de la fila de la letra o, si no se tocó, el
    // de «todas». Los acabados vienen por id ('corrugado' / 'liso') y las filas
    // de los colores por id de color.
    var eleccion = { base: [], acabado: [], tecla: [], letra: [] };
    res.letras.forEach(function (_, i) {
      PIEZAS_CLICER.forEach(function (pieza) {
        var sel = rootEl.querySelector('[data-pieza="' + pieza + '"][data-letra="' + i + '"]');
        eleccion[pieza].push((sel && sel.value) || listaDeClicer(pieza)[i] || '');
      });
    });

    var base = eleccion.base.map(function (id) { return findColor(config.colores, id); });
    var tecla = eleccion.tecla.map(function (id) { return findColor(config.colores, id); });
    var letra = eleccion.letra.map(function (id) { return findColor(config.colores, id); });
    var acabado = eleccion.acabado.map(function (id) {
      var a = Clicer.buscarAcabado(id);
      return a ? a.nombre : '';
    });

    if (base.concat(tecla, letra).some(function (c) { return !c; }) ||
        acabado.some(function (a) { return !a; })) {
      showFormError('Elige el color de la base, de la tecla y de la letra de cada letra (y el acabado de la base).', '#clicer-error');
      return;
    }

    var precio = Clicer.precioDe(config, res.letras.length);

    var clicker = {
      tipo: 'Clicker de Nombre',
      titulo: res.nombre,
      detalles: Clicer.detallesDe(Clicer.piezasDe(res.letras, {
        base: base, acabado: acabado, tecla: tecla, letra: letra
      })),
      precio: precio.total
    };
    if (guardarLinea(clicker)) return;
    Cart.add(clicker);

    hideFormError('#clicer-error');
    campo.value = '';
    limpiarPiezasClicer();
    pintarTeclas();
    updateClicerPrecio();
    campo.focus();
    window.App.toast('Agregado al carrito', 'success');
  }

  // Pinta el panel del carrito leyendo siempre del carrito compartido.
  function renderCart() {
    if (!rootEl) return;
    var body = rootEl.querySelector('#cart-body');
    if (!body) return;

    var items = Cart.getItems();

    var clear = rootEl.querySelector('#cart-clear');
    if (clear) clear.disabled = items.length === 0;

    if (!items.length) {
      body.innerHTML = '<p class="empty">Aún no hay productos en el carrito. ' +
        'Elige un producto en el menú para agregarlo.</p>';
      return;
    }

    var lineas = items.map(function (item) {
      var detalles = (item.detalles || []).map(function (d) {
        return '<span class="meta-tag">' + Utils.escapeHtml(d.label) + ' ' +
          Utils.marcaDetalle(d, 'dot') +
          Utils.escapeHtml(d.nombre) + '</span>';
      }).join('');

      var importe = item.cantidad > 1
        ? '<span class="cart-line__cant">' + item.cantidad + ' × ' + Utils.formatMoney(item.precio) + '</span>' +
          Utils.formatMoney(Cart.getLineTotal(item))
        : Utils.formatMoney(item.precio);

      return '' +
        '<div class="cart-line">' +
          '<div class="cart-line__info">' +
            '<span class="cart-line__type">' + Utils.escapeHtml(item.tipo) + '</span>' +
            '<span class="cart-line__name">' + Utils.escapeHtml(item.titulo) + '</span>' +
            (detalles ? '<span class="cart-line__meta">' + detalles + '</span>' : '') +
          '</div>' +
          '<span class="cart-line__price">' + importe + '</span>' +
          '<button class="icon-btn" type="button" data-remove="' + Utils.escapeHtml(item.id) + '" title="Quitar">✕</button>' +
        '</div>';
    }).join('');

    body.innerHTML = lineas +
      (Cart.getDescuento() > 0
        ? '<div class="cart-total cart-total--sub"><span>Descuento</span><span>\u2212' + Utils.formatMoney(Cart.getDescuento()) + '</span></div>'
        : '') +
      '<div class="cart-total"><span>Total</span><strong>' + Utils.formatMoney(Cart.getTotal()) + '</strong></div>';

    body.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Cart.remove(btn.getAttribute('data-remove'));
      });
    });
  }

  // El carrito es compartido: cualquier cambio (venga de este u otro producto)
  // refresca el panel si esta vista está montada. Solo se repinta el carrito,
  // nunca el formulario, para no borrar lo que el usuario está escribiendo.
  Cart.subscribe(function () {
    if (rootEl && rootEl.querySelector('#cart-body')) renderCart();
  });

  window.Views = window.Views || {};
  window.Views.productos = { render: render, subDe: subDe };
})();
