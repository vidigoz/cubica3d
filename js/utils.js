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

  // El descuento en pesos que de verdad se aplica: nunca negativo y nunca mayor
  // que el subtotal (la cotización no puede quedar en negativo). Es la misma
  // regla del servidor (descuentoValido, en api/functions/api.js).
  function descuentoValido(valor, subtotal) {
    var n = Math.round(parseNumber(valor, 0) * 100) / 100;
    return Math.min(Math.max(0, n), Math.max(0, subtotal));
  }

  // El punto de color de un detalle («Base ● Azul»). Un detalle sin color (el
  // desglose de una cotización manual: «Diseño · Logo de la empresa») no lleva
  // punto: lo separa del texto con un «·».
  function marcaDetalle(d, clase) {
    d = d || {};
    if (d.hex) return '<span class="' + clase + '" style="background:' + escapeHtml(d.hex) + '"></span>';
    return d.label && d.nombre ? '\u00b7 ' : '';
  }

  // Un EMOJI como patrón de expresión regular (úsese con la bandera `u`). Un emoji puede
  // ser varios caracteres —con su variante, un tono de piel, una bandera o varios unidos
  // (👨‍👩‍👧)—, así que se reconoce la secuencia entera y no carácter por carácter. Lo usan el
  // clicker y el charm para contar cada emoji como UNA letra.
  var EMOJI = '(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?' +
    '(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)';

  window.Utils = {
    EMOJI: EMOJI,
    marcaDetalle: marcaDetalle,
    descuentoValido: descuentoValido,
    uid: uid,
    formatMoney: formatMoney,
    escapeHtml: escapeHtml,
    normalize: normalize,
    parseNumber: parseNumber
  };
})();
