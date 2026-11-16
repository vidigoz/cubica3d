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

  // Una imagen elegida por el usuario, ya chica y lista para guardarse junto a una línea
  // del carrito: se acota a `maxPx` y se devuelve como data URL (PNG si conserva el
  // fondo transparente y no pesa mucho; si no, JPG sobre blanco).
  function imagenAData(archivo, maxPx) {
    maxPx = maxPx || 900;
    return new Promise(function (resolver, rechazar) {
      if (!archivo || !/^image\/(png|jpeg|webp|gif)$/.test(archivo.type)) {
        rechazar(new Error('Sube una imagen PNG, JPG, WEBP o GIF.'));
        return;
      }
      var img = new Image();
      var url = URL.createObjectURL(archivo);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var escala = Math.min(1, maxPx / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * escala));
        c.height = Math.max(1, Math.round(img.height * escala));
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var png = archivo.type === 'image/jpeg' ? '' : c.toDataURL('image/png');
        if (png && png.length <= 600000) { resolver(png); return; }
        var j = document.createElement('canvas');
        j.width = c.width;
        j.height = c.height;
        var jc = j.getContext('2d');
        jc.fillStyle = '#ffffff';
        jc.fillRect(0, 0, j.width, j.height);
        jc.drawImage(c, 0, 0);
        resolver(j.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rechazar(new Error('No se pudo leer la imagen.')); };
      img.src = url;
    });
  }

  window.Utils = {
    imagenAData: imagenAData,
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
