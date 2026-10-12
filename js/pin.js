/* Pantalla del PIN: el cotizador no se abre hasta que los 4 dígitos estén bien.
 *
 * El PIN vive en el servidor (variable PIN del api/.env): acá no se compara nada,
 * sólo se juntan los 4 dígitos y se mandan al API (POST /api/pin), que contesta si
 * están bien y, si lo están, abre la misma sesión de siempre. Por eso el PIN nunca
 * queda escrito en el navegador: lo que se guarda es el token, como con cualquier
 * otra entrada.
 *
 * No hay botón de entrar a propósito: al CUARTO dígito se verifica solo. Como no se
 * puede corregir después de mandarlo, el «⌫» del teclado borra el último dígito
 * antes de llegar al cuarto, y en la computadora se puede escribir con el teclado
 * de verdad (el Enter no hace nada: no hay nada que confirmar).
 *
 * La app la usa así (js/app.js):
 *   Pin.init({ verificar: fn(pin) -> { ok, mensaje }, alEntrar: fn(usuario) });
 *   Pin.mostrar('');   // aparece el pinpad
 *   Pin.ocultar();     // desaparece
 * Se expone como window.Pin */
(function () {
  'use strict';

  var DIGITOS = 4;    // tiene que ser el mismo que PIN_DIGITOS del API

  var el = document.getElementById('pin');
  var puntosEl = document.getElementById('pin-puntos');
  var teclasEl = document.getElementById('pin-teclas');
  var errorEl = document.getElementById('pin-error');

  var verificar = null;    // la pone la app: manda los 4 dígitos al API
  var alEntrar = null;     // ...y esto se llama cuando el PIN fue correcto
  var tipeado = '';
  var verificando = false; // mientras el servidor contesta, el teclado se ignora
  var sacudida = null;     // el timer que apaga la sacudida del PIN incorrecto

  function visible() {
    return !!el && !el.hidden;
  }

  function mostrarError(mensaje) {
    if (!errorEl) return;
    errorEl.textContent = mensaje || '';
    errorEl.hidden = !mensaje;
  }

  // Pinta los 4 casilleros: los que ya tienen dígito van llenos.
  function pintar() {
    if (puntosEl) {
      var puntos = puntosEl.querySelectorAll('[data-punto]');
      for (var i = 0; i < puntos.length; i++) {
        puntos[i].classList.toggle('pin__punto--lleno', i < tipeado.length);
      }
    }
    if (el) el.classList.toggle('pin--verificando', verificando);
  }

  function limpiar() {
    tipeado = '';
    pintar();
  }

  function sacudir() {
    if (!el) return;
    el.classList.add('pin--error');
    clearTimeout(sacudida);
    sacudida = setTimeout(function () { el.classList.remove('pin--error'); }, 400);
  }

  // Suma un dígito. Al cuarto se verifica solo: no hay botón de entrar.
  function agregar(digito) {
    if (verificando || !visible()) return;
    if (!/^[0-9]$/.test(String(digito))) return;
    if (tipeado.length >= DIGITOS) return;
    mostrarError('');
    tipeado += String(digito);
    pintar();
    if (tipeado.length === DIGITOS) comprobar();
  }

  // Corrección: saca el último dígito (hasta que se mande el cuarto).
  function borrar() {
    if (verificando) return;
    mostrarError('');
    tipeado = tipeado.slice(0, -1);
    pintar();
  }

  // PIN incorrecto (o la llamada se cayó): se limpia, se avisa y se puede probar
  // de nuevo en el momento.
  function avisar(mensaje) {
    mostrarError(mensaje);
    sacudir();
  }

  // Con los 4 dígitos juntos se le pregunta al servidor. Si están bien, se entra;
  // si no, se limpia y se avisa.
  function comprobar() {
    var intento = tipeado;
    verificando = true;
    pintar();

    // Encadenado en un `then` a propósito: así también cae acá un error temprano de
    // la propia llamada y el pinpad nunca queda trabado en "verificando".
    Promise.resolve()
      .then(function () { return verificar ? verificar(intento) : null; })
      .then(function (resultado) {
        verificando = false;
        pintar();
        limpiar();

        if (resultado && resultado.ok) {
          ocultar();
          if (alEntrar) alEntrar(resultado.usuario);
          return;
        }
        avisar((resultado && resultado.mensaje) || 'PIN incorrecto.');
      }, function (error) {
        verificando = false;
        pintar();
        limpiar();
        avisar((error && error.message) || 'No se pudo verificar el PIN.');
      });
  }

  // Aparece el pinpad. Con `mensaje` se explica algo (por ejemplo, que el PIN del
  // servidor está mal configurado); sin él, sólo se piden los 4 dígitos.
  function mostrar(mensaje) {
    if (!el) return;
    el.hidden = false;
    document.body.classList.add('con-pin');
    clearTimeout(sacudida);
    el.classList.remove('pin--error');   // una sacudida vieja no vuelve a sonar
    limpiar();
    mostrarError(mensaje || '');
  }

  function ocultar() {
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove('con-pin');
    clearTimeout(sacudida);
    el.classList.remove('pin--error');
    verificando = false;
    limpiar();
    mostrarError('');
  }

  // Deja el pinpad conectado: los botones, el teclado de la computadora y lo que
  // hay que hacer cuando el PIN está bien.
  function init(opciones) {
    var o = opciones || {};
    verificar = o.verificar || null;
    alEntrar = o.alEntrar || null;

    // Un solo listener para todo el teclado: cada tecla dice qué es con sus
    // atributos (data-digito / data-borrar), así no quedan once listeners sueltos.
    if (teclasEl) {
      teclasEl.addEventListener('click', function (e) {
        var tecla = e.target && e.target.closest ? e.target.closest('[data-digito], [data-borrar]') : null;
        if (!tecla) return;
        if (tecla.hasAttribute('data-borrar')) borrar();
        else agregar(tecla.getAttribute('data-digito'));
      });
    }

    // Con teclado de verdad: los números entran solos y el borrar también sirve.
    document.addEventListener('keydown', function (e) {
      if (!visible() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key >= '0' && e.key <= '9') { agregar(e.key); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); borrar(); }
    });
  }

  window.Pin = {
    DIGITOS: DIGITOS,
    init: init,
    mostrar: mostrar,
    ocultar: ocultar,
    agregar: agregar,
    borrar: borrar,
    visible: visible
  };
})();
