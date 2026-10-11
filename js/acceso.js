/* Aviso de arranque: acá ya no se pide correo ni contraseña (no hay login).
 *
 * La app le pide la sesión al API (POST /api/acceso) y el servidor la abre sola
 * con la cuenta del taller: no hay nada que escribir. Mientras eso pasa —y si
 * algo falla— se ve esta pantalla, que sólo explica el motivo y ofrece
 * «Reintentar» (el botón vuelve a llamar al arranque de la app).
 *
 * Se expone como window.Acceso */
(function () {
  'use strict';

  var el = document.getElementById('acceso');
  var mensajeEl = document.getElementById('acceso-mensaje');
  var errorEl = document.getElementById('acceso-error');
  var boton = document.getElementById('acceso-reintentar');

  // Lo que dice la pantalla mientras se está entrando (sale del propio HTML).
  var ESPERA = mensajeEl ? mensajeEl.textContent : 'Entrando…';

  var alReintentar = null;

  function mostrarError(mensaje) {
    if (!errorEl) return;
    errorEl.textContent = mensaje || '';
    errorEl.hidden = !mensaje;
  }

  // Se muestra la pantalla. Con mensaje, se explica por qué no se pudo entrar.
  function mostrar(mensaje) {
    if (!el) return;
    el.hidden = false;
    document.body.classList.add('con-acceso');
    if (mensajeEl) mensajeEl.textContent = mensaje ? 'No se pudo entrar.' : ESPERA;
    mostrarError(mensaje || '');
    // Con el motivo a la vista, el foco va al botón para reintentar de una.
    if (mensaje && boton) setTimeout(function () { boton.focus(); }, 30);
  }

  function ocultar() {
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove('con-acceso');
    mostrarError('');
    if (mensajeEl) mensajeEl.textContent = ESPERA;
  }

  // Conecta el botón «Reintentar» con el arranque de la app (le pasa `fn`).
  function init(fn) {
    alReintentar = fn || null;
    if (!boton) return;

    boton.addEventListener('click', function () {
      mostrar('');                       // vuelve al estado «entrando…»
      if (alReintentar) alReintentar();
    });

    // El correo recordado del login viejo ya no se usa para nada: se borra.
    try {
      window.localStorage.removeItem('cotizador.ultimo-correo');
    } catch (e) {
      /* sin almacenamiento: no hay nada que borrar */
    }
  }

  window.Acceso = {
    init: init,
    mostrar: mostrar,
    ocultar: ocultar
  };
})();
