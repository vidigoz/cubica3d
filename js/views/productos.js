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
  var currentSub = null;   // null = menú · 'llaveros' · 'clicers' = formulario

  // Lo elegido letra por letra en el clicker, una lista por pieza (base, acabado,
  // tecla y letra), alineada con las letras del nombre. Se mantiene mientras se
  // escribe (y mientras cambia la cantidad de letras) y se pierde al salir del
  // formulario. Vacío = todavía sigue a los menús «todas».
  var clicerBase = [];        // color de la base, uno por letra
  var clicerAcabados = [];    // acabado de la base (Corrugado / Liso), uno por letra
  var clicerTeclas = [];      // color de la tecla, uno por letra
  var clicerLetras = [];      // color de la letra impresa, uno por letra

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

  /* ---------------------------- Plantillas ---------------------------- */

  function pageHead() {
    return '' +
      '<div class="page__head">' +
        '<h2 class="page__title">Productos</h2>' +
        '<p class="page__subtitle">Elige el producto, agrégalo al carrito y envía la cotización desde ahí.</p>' +
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
            '<button class="btn btn--primary" type="submit"' + dis + '>Agregar al carrito</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  // Formulario del Clicker de Nombre: cada letra del nombre lleva TRES piezas
  // (base con su color y su acabado, tecla y letra) y cada pieza lleva su color.
  // Arriba hay un menú «todas» por pieza (el nombre entero igual) y abajo una
  // fila por letra para cambiar sólo esa letra.
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
        '<h3 class="panel__title">Clicker de Nombre</h3>' +
        (sinColores
          ? '<p class="alert alert--warn">No hay colores en stock. Agrégalos en <b>⚙️ Configuración</b> (arriba a la derecha) para poder cotizar.</p>'
          : '') +
        '<p class="panel__hint">Cada letra del nombre lleva una <b>base</b> (con su color y su acabado, corrugado o liso), una <b>tecla</b> y una <b>letra</b>. Con los menús de «todas» queda el nombre entero igual; si querés, abajo cambiás una letra suelta.</p>' +
        '<form class="form" id="form-clicer" novalidate>' +
          '<div class="form__row form__row--tres">' +
            '<label class="field field--grow">' +
              '<span class="field__label">Nombre</span>' +
              '<input class="field__input" type="text" id="f-clicer-nombre" placeholder="Ej. Ali" autocomplete="off"' + dis + ' />' +
            '</label>' +
            '<div class="field field--grow">' +
              '<span class="field__label">Base · Acabado de todas</span>' +
              '<select class="field__input" id="f-clicer-acabado"' + dis + '>' + opcionesAcabado + '</select>' +
            '</div>' +
            '<div class="field field--grow">' +
              '<span class="field__label">Base · Color de todas</span>' +
              '<div class="field__row">' +
                '<select class="field__input" id="f-clicer-base"' + dis + '>' + options + '</select>' +
                '<span class="swatch" id="swatch-clicer-base"></span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="form__row">' +
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
            '<button class="btn btn--primary" type="submit"' + dis + '>Agregar al carrito</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  function cartTemplate() {
    return '' +
      '<section class="panel">' +
        '<div class="cart__head">' +
          '<h3 class="panel__title">Carrito de cotización</h3>' +
          '<div class="cart__actions">' +
            '<button class="btn btn--ghost" type="button" id="cart-detail">Ver desglose</button>' +
            '<button class="btn btn--ghost" type="button" id="cart-clear">Limpiar</button>' +
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
    if (sub !== undefined) currentSub = (sub === 'llaveros' || sub === 'clicers') ? sub : null;

    var formulario = currentSub === 'llaveros' ? formTemplate()
      : currentSub === 'clicers' ? clicerTemplate()
      : listTemplate();

    rootEl.innerHTML =
      '<div class="page">' +
        pageHead() +
        formulario +
        cartTemplate() +
      '</div>';

    bind(rootEl);
    renderCart();

    if (currentSub === 'llaveros') {
      updateSwatches();
      updatePricePreview();
    }

    if (currentSub === 'clicers') {
      limpiarPiezasClicer();       // formulario recién montado: todo con lo de «todas»
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

    // Formulario del clicker: los menús «todas» (base con su acabado, tecla y
    // letra) y una fila por letra del nombre.
    var clicerForm = container.querySelector('#form-clicer');
    if (clicerForm) {
      clicerForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addClicerToCart();
      });

      var nombreClicer = container.querySelector('#f-clicer-nombre');
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

    Cart.add({
      tipo: 'Llavero de Nombre',
      titulo: nombre + (apellido ? ' ' + apellido : ''),
      detalles: [
        { label: 'Base', nombre: base.nombre, hex: base.hex },
        { label: 'Nombre', nombre: colorNombre.nombre, hex: colorNombre.hex }
      ],
      precio: precio
    });

    hideFormError();
    rootEl.querySelector('#f-nombre').value = '';
    rootEl.querySelector('#f-apellido').value = '';
    rootEl.querySelector('#f-nombre').focus();

    updatePricePreview();
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
  // se puede leer desde el contenedor.
  function piezaTemplate(pieza, rotulo, i, letra, opciones, dis, conMuestra) {
    return '' +
      '<label class="tecla__campo">' +
        '<span class="tecla__rotulo">' + Utils.escapeHtml(rotulo) + '</span>' +
        '<span class="field__row">' +
          '<select class="field__input" data-pieza="' + pieza + '" data-letra="' + i + '" ' +
            'aria-label="' + Utils.escapeHtml(rotulo + ' de la ' + letra) + '"' + dis + '>' +
            opciones +
          '</select>' +
          (conMuestra
            ? '<span class="swatch swatch--sm" data-muestra="' + pieza + '" data-letra="' + i + '"></span>'
            : '') +
        '</span>' +
      '</label>';
  }

  // Reparte el nombre en filas: una por letra, con la base (color y acabado), la
  // tecla y la letra que le tocaron. Se vuelve a llamar con cada letra que se
  // escribe, así que cada letra conserva lo que ya tenía elegido.
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
  // completo de CADA letra: su base (color y acabado), su tecla y su letra, que
  // es lo que se necesita para fabricarlo.
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

    Cart.add({
      tipo: 'Clicker de Nombre',
      titulo: res.nombre,
      detalles: Clicer.detallesDe(Clicer.piezasDe(res.letras, {
        base: base, acabado: acabado, tecla: tecla, letra: letra
      })),
      precio: precio.total
    });

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
          '<span class="dot" style="background:' + Utils.escapeHtml(d.hex) + '"></span>' +
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
  window.Views.productos = { render: render };
})();
