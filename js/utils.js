/* Utilidades generales. Se expone como window.Utils */
(function () {
  'use strict';

  // Identificador único simple para colores y líneas de cotización.
  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // Formato de moneda en pesos: 60 -> "$60.00"
  function formatMoney(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return '$' + n.toFixed(2);
  }

  // Escapa texto para insertarlo de forma segura en innerHTML.
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Quita espacios al inicio/fin.
  function normalize(value) {
    return String(value == null ? '' : value).trim();
  }

  // Convierte a número. Si no es válido, devuelve el fallback (por defecto 0).
  function parseNumber(value, fallback) {
    var n = parseFloat(value);
    if (isFinite(n)) return n;
    return typeof fallback === 'number' ? fallback : 0;
  }

  window.Utils = {
    uid: uid,
    formatMoney: formatMoney,
    escapeHtml: escapeHtml,
    normalize: normalize,
    parseNumber: parseNumber
  };
})();
