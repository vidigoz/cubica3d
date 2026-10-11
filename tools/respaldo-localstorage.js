/* Respaldo de todo lo que el cotizador guarda en ESTE navegador.
 *
 * Cómo usarlo:
 *   1) Abre el cotizador en el navegador donde están los datos de verdad.
 *   2) F12 -> pestaña "Consola" -> pegá todo este archivo y pulsa Enter.
 *   3) Se descarga `respaldo-cubica3d.json` con config, tablero y carrito.
 *
 * Ese archivo es el que come `api/tools/migrar.js` para pasarlo a Neon:
 *   cd api && npm run migrar -- ../respaldo-cubica3d.json
 *
 * Se puede correr las veces que quieras: no borra nada, sólo lee. */
(function () {
  'use strict';

  var CLAVES = {
    config: 'cotizador.config.v1',
    proceso: 'cotizador.proceso.v1',
    carrito: 'cotizador.carrito.v1'
  };

  function leer(clave) {
    try {
      var raw = window.localStorage.getItem(clave);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('No se pudo leer ' + clave + ': ' + e.message);
      return null;
    }
  }

  var respaldo = {
    generado: new Date().toISOString(),
    origen: window.location.href,
    config: leer(CLAVES.config),
    proceso: leer(CLAVES.proceso),
    carrito: leer(CLAVES.carrito)
  };

  var colores = (respaldo.config && respaldo.config.colores) || [];
  var tarjetas = (respaldo.proceso && respaldo.proceso.tarjetas) || [];

  var blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = 'respaldo-cubica3d.json';
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);

  console.log('Respaldo listo: ' + colores.length + ' color(es) en stock, ' + tarjetas.length + ' tarjeta(s) del tablero.');
  console.log('Ahora:  cd api && npm run migrar -- ../respaldo-cubica3d.json');
})();
