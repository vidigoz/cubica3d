/* Pantalla de acceso: pide el correo y la clave una sola vez y guarda la sesión.
 *
 * El API vive en un servidor compartido, así que necesita saber quién entra:
 * todos los pedidos de la app llevan el token que devuelve /api/login. Acá sólo
 * se maneja ese formulario; la app arranca cuando el login sale bien (`onEntrar`).
 *
 * Se expone como window.Acceso */
(function () {
  'use strict';

  var el = document.getElementById('acceso');
  var form = document.getElementById('acceso-form');
  var campoEmail = document.getElementById('acceso-email');
  var campoClave = document.getElementById('acceso-password');
  var boton = document.getElementById('acceso-boton');
  var errorEl = document.getElementById('acceso-error');

  var alEntrar = null;
  var enviando = false;

  function mostrarError(mensaje) {
    if (!errorEl) return;
    errorEl.textContent = mensaje || '';
    errorEl.hidden = !mensaje;
  }

  function mostrar(mensaje) {
    if (!el) return;
    el.hidden = false;
    document.body.classList.add('con-acceso');
    mostrarError(mensaje || '');
    if (campoClave) campoClave.value = '';
    // El foco va al correo sólo si todavía no hay nada escrito.
    var foco = campoEmail && !campoEmail.value ? campoEmail : campoClave;
    if (foco) setTimeout(function () { foco.focus(); }, 30);
  }

  function ocultar() {
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove('con-acceso');
    mostrarError('');
  }

  function enviar() {
    if (enviando) return;
    var email = window.Utils.normalize(campoEmail && campoEmail.value);
    var clave = campoClave ? campoClave.value : '';

    if (!email || !clave) {
      mostrarError('Escribe tu correo y tu contraseña.');
      return;
    }

    enviando = true;
    if (boton) {
      boton.disabled = true;
      boton.textContent = 'Entrando…';
    }
    mostrarError('');

    window.Api.login(email, clave)
      .then(function () {
        recordar(email);
        if (alEntrar) return alEntrar();
      })
      .catch(function (error) {
        mostrarError(error.message || 'No se pudo entrar.');
        if (campoClave) {
          campoClave.value = '';
          campoClave.focus();
        }
      })
      .then(function () {
        enviando = false;
        if (boton) {
          boton.disabled = false;
          boton.textContent = 'Entrar';
        }
      });
  }

  // Se recuerda el correo (nunca la clave) para la próxima entrada.
  function recordar(email) {
    try {
      window.localStorage.setItem('cotizador.ultimo-correo', email);
    } catch (e) {
      /* sin almacenamiento: se escribe a mano la próxima vez */
    }
  }

  function init(fn) {
    alEntrar = fn || null;
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      enviar();
    });

    // Al escribir se borra el aviso anterior: deja de tener sentido.
    form.addEventListener('input', function () { mostrarError(''); });

    // Si hay un correo recordado de la última vez, se precarga.
    try {
      var ultimo = window.localStorage.getItem('cotizador.ultimo-correo');
      if (ultimo && campoEmail) campoEmail.value = ultimo;
    } catch (e) {
      /* sin almacenamiento: se escribe a mano */
    }
  }

  window.Acceso = {
    init: init,
    mostrar: mostrar,
    ocultar: ocultar
  };
})();
