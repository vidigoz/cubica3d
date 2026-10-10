/* Vista de Configuración: colores en stock y precios.
 * Se expone como window.Views.configuracion */
(function () {
  'use strict';

  var Utils = window.Utils;
  var Store = window.Store;

  /* ---------------------------- Plantillas ---------------------------- */

  function pageHead() {
    return '' +
      '<div class="page__head">' +
        '<h2 class="page__title">Configuración</h2>' +
        '<p class="page__subtitle">Ajusta los colores en stock y los precios que se usan al cotizar.</p>' +
      '</div>';
  }

  function coloresTemplate(config) {
    var lista;
    if (!config.colores.length) {
      lista = '<p class="empty">No hay colores en stock. Agrega el primero.</p>';
    } else {
      lista = '<ul class="color-list">' + config.colores.map(function (c) {
        return '' +
          '<li class="color-item">' +
            '<span class="swatch swatch--sm" style="background:' + Utils.escapeHtml(c.hex) + '"></span>' +
            '<span class="color-item__name">' + Utils.escapeHtml(c.nombre) + '</span>' +
            '<span class="color-item__hex">' + Utils.escapeHtml(c.hex) + '</span>' +
            '<button class="icon-btn" type="button" data-remove-color="' + Utils.escapeHtml(c.id) + '" title="Quitar color">✕</button>' +
          '</li>';
      }).join('') + '</ul>';
    }

    return '' +
      '<section class="panel">' +
        '<h3 class="panel__title">Colores en stock</h3>' +
        '<p class="panel__hint">Estos colores aparecen en los menús de <b>Color de Base</b> y <b>Color del Nombre</b>.</p>' +
        lista +
        '<form class="form form--inline" id="form-color">' +
          '<label class="field field--grow">' +
            '<span class="field__label">Nombre del color</span>' +
            '<input class="field__input" type="text" id="c-nombre" placeholder="Ej. Azul cielo" autocomplete="off" />' +
          '</label>' +
          '<label class="field">' +
            '<span class="field__label">Muestra</span>' +
            '<input class="field__input field__input--color" type="color" id="c-hex" value="#3B82F6" />' +
          '</label>' +
          '<button class="btn btn--primary" type="submit">Agregar color</button>' +
        '</form>' +
        '<p class="form__error" id="color-error" hidden></p>' +
      '</section>';
  }

  function preciosTemplate(config) {
    return '' +
      '<section class="panel">' +
        '<h3 class="panel__title">Precios</h3>' +
        '<p class="panel__hint">Se aplican automáticamente según si incluyes apellido.</p>' +
        '<form class="form form--inline" id="form-precios">' +
          '<label class="field field--grow">' +
            '<span class="field__label">Solo nombre</span>' +
            '<input class="field__input" type="number" min="0" step="1" id="p-nombre" value="' + config.precios.nombre + '" />' +
          '</label>' +
          '<label class="field field--grow">' +
            '<span class="field__label">Nombre + Apellido</span>' +
            '<input class="field__input" type="number" min="0" step="1" id="p-nombreApellido" value="' + config.precios.nombreApellido + '" />' +
          '</label>' +
          '<button class="btn btn--primary" type="submit">Guardar precios</button>' +
        '</form>' +
        '<p class="form__error" id="precio-error" hidden></p>' +
      '</section>';
  }

  function defaultsTemplate() {
    return '' +
      '<section class="panel panel--muted">' +
        '<h3 class="panel__title">Valores por defecto</h3>' +
        '<p class="panel__hint">Restaura los colores y precios originales.</p>' +
        '<div><button class="btn btn--ghost" type="button" id="btn-reset">Restaurar valores por defecto</button></div>' +
      '</section>';
  }

  /* ---------------------------- Render ---------------------------- */

  function render(container) {
    var config = Store.getConfig();

    container.innerHTML =
      '<div class="page">' +
        pageHead() +
        coloresTemplate(config) +
        preciosTemplate(config) +
        defaultsTemplate() +
      '</div>';

    bind(container);
  }

  function bind(container) {
    // Agregar color
    var colorForm = container.querySelector('#form-color');
    colorForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var nombre = Utils.normalize(container.querySelector('#c-nombre').value);
      var hex = container.querySelector('#c-hex').value;
      var res = Store.addColor(nombre, hex);
      if (!res.ok) {
        showError(container, '#color-error', res.error);
        return;
      }
      window.App.toast('Color agregado', 'success');
      render(container);
    });

    // Quitar color
    container.querySelectorAll('[data-remove-color]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var res = Store.removeColor(btn.getAttribute('data-remove-color'));
        if (!res.ok) {
          showError(container, '#color-error', res.error);
          return;
        }
        window.App.toast('Color eliminado');
        render(container);
      });
    });

    // Guardar precios
    var preciosForm = container.querySelector('#form-precios');
    preciosForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = Utils.parseNumber(container.querySelector('#p-nombre').value, NaN);
      var na = Utils.parseNumber(container.querySelector('#p-nombreApellido').value, NaN);

      if (!isFinite(n) || n < 0) {
        showError(container, '#precio-error', 'El precio de "Solo nombre" debe ser un número mayor o igual a 0.');
        return;
      }
      if (!isFinite(na) || na < 0) {
        showError(container, '#precio-error', 'El precio de "Nombre + Apellido" debe ser un número mayor o igual a 0.');
        return;
      }

      Store.setPrecios({ nombre: n, nombreApellido: na });
      hideError(container, '#precio-error');
      window.App.toast('Precios guardados', 'success');
    });

    // Restaurar valores por defecto
    container.querySelector('#btn-reset').addEventListener('click', function () {
      if (!window.confirm('¿Restaurar los colores y precios por defecto? Se perderán tus cambios.')) return;
      Store.resetDefaults();
      window.App.toast('Valores restaurados', 'success');
      render(container);
    });
  }

  /* ---------------------------- Helpers ---------------------------- */

  function showError(container, selector, msg) {
    var el = container.querySelector(selector);
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function hideError(container, selector) {
    var el = container.querySelector(selector);
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  }

  window.Views = window.Views || {};
  window.Views.configuracion = { render: render };
})();
