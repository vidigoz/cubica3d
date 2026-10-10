/* Vista de Productos: menú de productos (Llaveros de Nombre / Clicker de Nombre),
 * formulario del producto y el carrito de cotización compartido (window.Cart).
 * Ruta: #/productos. Se expone como window.Views.productos */
(function () {
  'use strict';

  var Utils = window.Utils;
  var Store = window.Store;
  var Cart = window.Cart;

  var rootEl = null;
  var currentSub = null; // null = menú de productos, 'llaveros' = formulario

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
          productCard('clickers', 'productos', '🖱️', 'Clicker de Nombre',
            'Disponible en una siguiente versión.', true) +
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

  // sub: null = menú de productos · 'llaveros' = formulario del llavero.
  // Se llama desde App en cada navegación (hash) y también internamente.
  function render(container, sub) {
    if (container) rootEl = container;
    if (sub !== undefined) currentSub = sub === 'llaveros' ? 'llaveros' : null;

    rootEl.innerHTML =
      '<div class="page">' +
        pageHead() +
        (currentSub === 'llaveros' ? formTemplate() : listTemplate()) +
        cartTemplate() +
      '</div>';

    bind(rootEl);
    renderCart();

    if (currentSub === 'llaveros') {
      updateSwatches();
      updatePricePreview();
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

  function showFormError(msg) {
    if (!rootEl) return;
    var el = rootEl.querySelector('#form-error');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function hideFormError() {
    if (!rootEl) return;
    var el = rootEl.querySelector('#form-error');
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
