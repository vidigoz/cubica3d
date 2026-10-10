/* Optimizador del logo de Cubica3D.
 * Toma icons/cubica.png (maestro, 1254x1254 con fondo blanco), le vuelve
 * transparente el blanco que toca el borde, recorta los márgenes y guarda el
 * resultado a 320x320 en icons/cubica-logo.png.
 * Se usa abriendo tools/logo.html con un servidor local (ver el HTML). */
(function () {
  'use strict';

  var ENTRADA = '../icons/cubica.png';
  var LADO = 320;   // tamaño final en px
  var PAD = 8;      // respiro alrededor del cubo
  var UMBRAL = 18;  // tolerancia para considerar un pixel "blanco"

  var info = document.getElementById('info');
  var salida = document.getElementById('prev-salida');
  var enlace = document.getElementById('descargar');

  function blanco(px, i) {
    var o = i * 4;
    return px[o] >= 255 - UMBRAL && px[o + 1] >= 255 - UMBRAL && px[o + 2] >= 255 - UMBRAL;
  }

  function optimizar(img) {
    var w = img.naturalWidth, h = img.naturalHeight;

    var lienzo = document.createElement('canvas');
    lienzo.width = w;
    lienzo.height = h;
    var ctx = lienzo.getContext('2d');
    ctx.drawImage(img, 0, 0);

    var datos = ctx.getImageData(0, 0, w, h);
    var px = datos.data;

    // 1) El blanco CONECTADO AL BORDE se vuelve transparente (el blanco de
    //    dentro del cubo se queda: no toca el borde).
    var fondo = new Uint8Array(w * h);
    var pila = [];

    function empujar(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      var i = y * w + x;
      if (fondo[i] || !blanco(px, i)) return;
      fondo[i] = 1;
      pila.push(i);
    }

    var x, y;
    for (x = 0; x < w; x++) { empujar(x, 0); empujar(x, h - 1); }
    for (y = 0; y < h; y++) { empujar(0, y); empujar(w - 1, y); }

    while (pila.length) {
      var i = pila.pop();
      var cx = i % w, cy = (i - cx) / w;
      empujar(cx + 1, cy); empujar(cx - 1, cy); empujar(cx, cy + 1); empujar(cx, cy - 1);
    }

    // 2) Caja del dibujo que queda.
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var k = 0; k < w * h; k++) {
      if (fondo[k]) { px[k * 4 + 3] = 0; continue; }
      var kx = k % w, ky = (k - kx) / w;
      if (kx < minX) minX = kx;
      if (kx > maxX) maxX = kx;
      if (ky < minY) minY = ky;
      if (ky > maxY) maxY = ky;
    }
    if (maxX < 0) return null;
    ctx.putImageData(datos, 0, 0);

    // 3) Recorte cuadrado a LADO px, centrado.
    var cw = maxX - minX + 1, ch = maxY - minY + 1;
    var escala = (LADO - PAD * 2) / Math.max(cw, ch);

    var destino = document.createElement('canvas');
    destino.width = LADO;
    destino.height = LADO;
    var dctx = destino.getContext('2d');
    var dw = cw * escala, dh = ch * escala;
    dctx.drawImage(lienzo, minX, minY, cw, ch, (LADO - dw) / 2, (LADO - dh) / 2, dw, dh);

    return { dataUrl: destino.toDataURL('image/png'), caja: cw + 'x' + ch, original: w + 'x' + h };
  }

  var img = new Image();
  img.onload = function () {
    var r = optimizar(img);
    if (!r) {
      info.textContent = 'No se pudo procesar la imagen.';
      document.title = 'ERROR proceso';
      return;
    }
    salida.src = r.dataUrl;
    enlace.href = r.dataUrl;
    enlace.hidden = false;

    var kb = Math.round((r.dataUrl.length - 'data:image/png;base64,'.length) * 0.75 / 1024);
    info.textContent = 'Maestro ' + r.original + ' → recorte ' + r.caja +
      ' → salida ' + LADO + 'x' + LADO + ' px (~' + kb + ' KB).';
    document.title = 'LISTO ' + LADO + ' ' + kb;
  };
  img.onerror = function () {
    info.textContent = 'No se pudo cargar ' + ENTRADA +
      '. ¿Lo abriste con file:// ? Usa un servidor local (ver los pasos de arriba).';
    document.title = 'ERROR carga';
  };
  img.src = ENTRADA;
})();
