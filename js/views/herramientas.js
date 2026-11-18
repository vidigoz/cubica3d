/* Vista de Herramientas: enlaces a las páginas que se usan para crear diseños.
 * Cada tarjeta abre su enlace en una pestaña nueva.
 * Se expone como window.Views.herramientas */
(function () {
  'use strict';

  var Utils = window.Utils;

  // `ruta`: herramienta propia de esta app (se abre aquí); `url`: página externa (otra pestaña).
  var HERRAMIENTAS = [
    { icono: '🖼️', nombre: 'Marco de fotos', detalle: 'Marco con texto curvo: colores y STL', ruta: 'herramientas/marco' },
    { icono: '🔑', nombre: 'Llaveros', detalle: 'Diseñador de llaveros (bajaforma)', url: 'https://bajaforma.netlify.app/' },
    { icono: '🪑', nombre: 'Charms de Silla', detalle: 'Diseñador de charms de silla', url: 'https://charmdesilla.netlify.app/' },
    { icono: '🖼️', nombre: 'Logo Llavero', detalle: 'MakerWorld: imagen a llavero', url: 'https://makerworld.com/es/makerlab/imageToKeychain?from=makerlab' },
    { icono: '⚽', nombre: 'Camisetas Llavero', detalle: 'MakerWorld: llavero de camiseta de fútbol', url: 'https://makerworld.com/es/models/2611816-customizable-soccer-football-jersey-keychain?from=search#profileId-2882356' }
  ];

  function render(container, sub) {
    if (sub === 'marco' && window.Views.marco) { window.Views.marco.render(container); return; }
    container.innerHTML = '' +
      '<div class="page__head">' +
        '<h2 class="page__title">Herramientas</h2>' +
        '<p class="page__subtitle">Herramientas para crear diseños. Las externas se abren en otra pestaña.</p>' +
      '</div>' +
      '<div class="herramientas">' + HERRAMIENTAS.map(function (h) {
        var destino = h.ruta
          ? 'href="#/' + Utils.escapeHtml(h.ruta) + '"'
          : 'href="' + Utils.escapeHtml(h.url) + '" target="_blank" rel="noopener noreferrer"';
        return '' +
          '<a class="herramienta" ' + destino + '>' +
            '<span class="herramienta__icono" aria-hidden="true">' + h.icono + '</span>' +
            '<span class="herramienta__texto">' +
              '<span class="herramienta__nombre">' + Utils.escapeHtml(h.nombre) + '</span>' +
              '<span class="herramienta__detalle">' + Utils.escapeHtml(h.detalle) + '</span>' +
            '</span>' +
            '<span class="herramienta__ir" aria-hidden="true">' + (h.ruta ? '→' : '↗') + '</span>' +
          '</a>';
      }).join('') + '</div>';
  }

  window.Views = window.Views || {};
  window.Views.herramientas = { render: render };
})();
