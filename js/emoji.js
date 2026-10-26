/* Selector de emojis para la PC.
 *
 * En el celular el teclado ya trae sus emojis, así que ahí sólo se escribe. En la
 * computadora no hay un selector que se pueda abrir desde la página, así que éste es
 * un cuadrito con los emojis más usados, por categoría: se pulsa uno y se inserta en
 * el campo donde está el cursor (EmojiPicker.alternar(campo, botón)).
 * Se expone como window.EmojiPicker */
(function () {
  'use strict';

  var CATEGORIAS = [
    { nombre: 'Caras', emojis: '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 😎 🤓 🥳 🤩 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤤 😴 🤒 🤕 🤢 🤮 🥴 😷 🤠 🥸 😈 👿 👻 💀 🤡 👽 🤖' },
    { nombre: 'Corazones y símbolos', emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ⭐ 🌟 ✨ ⚡ 🔥 💥 💫 💦 💧 🌈 ☀️ 🌙 ☁️ ❄️ 💯 ✅ ❌ ❓ ❗ ♻️ ☮️ ☯️ ♾️ ⚜️ 🔱 🎵 🎶 💲' },
    { nombre: 'Gestos y personas', emojis: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🖐️ 👋 🤚 👏 🙌 👐 🤝 🙏 💪 🦾 👀 🧠 👑 🎓 👶 👦 👧 👨 👩 🧑 👴 👵 🦸 🦹 🧙 🧚 🧜 🧛 🥷 💃 🕺' },
    { nombre: 'Animales y naturaleza', emojis: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🦋 🐛 🐌 🐞 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐘 🦒 🦓 🦘 🐕 🐈 🌵 🎄 🌲 🌳 🌴 🍀 🌷 🌹 🌺 🌸 🌼 🌻 🍁 🍂 🍃 🍄' },
    { nombre: 'Comida', emojis: '🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌽 🥕 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍿 🧁 🍰 🎂 🍩 🍪 🍫 🍬 🍭 🍦 🍨 ☕ 🍵 🧃 🥤 🍺 🍷' },
    { nombre: 'Deportes y objetos', emojis: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳ 🏆 🥇 🥈 🥉 🏅 🎮 🕹️ 🎲 🎯 🎨 🎭 🎤 🎧 🎸 🎹 🥁 🎺 🎻 🚗 🚕 🚌 🏎️ 🚓 🚑 🚒 🚲 🛵 🏍️ ✈️ 🚀 🛸 ⛵ 🚢 🏠 🏰 🎁 🎈 🎉 🎊 🔔 📚 ✏️ 💡 🔑 🛒 💎 ⌚ 📷 💻 📱' },
    { nombre: 'Banderas', emojis: '🇲🇽 🇺🇸 🇨🇦 🇪🇸 🇦🇷 🇨🇴 🇨🇱 🇵🇪 🇧🇷 🇻🇪 🇪🇨 🇬🇹 🇨🇷 🇵🇦 🇩🇴 🇨🇺 🇫🇷 🇮🇹 🇩🇪 🇬🇧 🇯🇵 🇰🇷 🇨🇳 🏳️‍🌈 🏴‍☠️ 🏁 🚩' }
  ];

  var panel = null;       // el cuadro abierto (uno solo a la vez)
  var cierre = null;      // lo que lo cierra al pulsar afuera o con Esc

  function cerrar() {
    if (!panel) return;
    panel.remove();
    panel = null;
    document.removeEventListener('mousedown', cierre, true);
    document.removeEventListener('keydown', cierre, true);
    window.removeEventListener('resize', cerrar);
    cierre = null;
  }

  // Mete el emoji en el campo, donde está el cursor (o reemplazando lo seleccionado),
  // y avisa con un evento «input» para que el formulario se entere como si se hubiera
  // escrito.
  function insertar(campo, emoji) {
    var valor = campo.value;
    var ini = typeof campo.selectionStart === 'number' ? campo.selectionStart : valor.length;
    var fin = typeof campo.selectionEnd === 'number' ? campo.selectionEnd : ini;
    campo.value = valor.slice(0, ini) + emoji + valor.slice(fin);
    var cursor = ini + emoji.length;
    campo.focus();
    try { campo.setSelectionRange(cursor, cursor); } catch (e) { /* un tipo de campo sin cursor */ }
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function abrir(campo, boton) {
    cerrar();
    panel = document.createElement('div');
    panel.className = 'emoji-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Emojis');
    panel.innerHTML = CATEGORIAS.map(function (cat) {
      return '<p class="emoji-panel__cat">' + cat.nombre + '</p>' +
        '<div class="emoji-panel__grid">' + cat.emojis.split(' ').map(function (e) {
          return '<button class="emoji-panel__item" type="button" data-emoji="' + e + '">' + e + '</button>';
        }).join('') + '</div>';
    }).join('');

    // Se queda abajo del botón; si no cabe, arriba.
    document.body.appendChild(panel);
    var caja = boton.getBoundingClientRect();
    var ancho = Math.min(340, window.innerWidth - 16);
    panel.style.width = ancho + 'px';
    panel.style.left = Math.max(8, Math.min(caja.right - ancho, window.innerWidth - ancho - 8)) + 'px';
    var alto = panel.offsetHeight;
    var abajo = caja.bottom + 6;
    panel.style.top = (abajo + alto > window.innerHeight - 8 && caja.top - alto - 6 > 8
      ? caja.top - alto - 6 : abajo) + 'px';

    // Pulsar un emoji lo inserta y deja el cuadro abierto (se pueden poner varios);
    // pulsar afuera o Esc lo cierra.
    panel.addEventListener('mousedown', function (e) { e.preventDefault(); });   // el campo no pierde el cursor
    panel.addEventListener('click', function (e) {
      var item = e.target.closest('[data-emoji]');
      if (item) insertar(campo, item.getAttribute('data-emoji'));
    });
    cierre = function (e) {
      if (e.type === 'keydown') {
        if (e.key === 'Escape') { cerrar(); campo.focus(); }
        return;
      }
      if (panel && !panel.contains(e.target) && !boton.contains(e.target)) cerrar();
    };
    document.addEventListener('mousedown', cierre, true);
    document.addEventListener('keydown', cierre, true);
    window.addEventListener('resize', cerrar);
  }

  // Abre el cuadro si estaba cerrado y lo cierra si estaba abierto.
  function alternar(campo, boton) {
    if (panel) { cerrar(); return; }
    abrir(campo, boton);
  }

  window.EmojiPicker = { alternar: alternar, cerrar: cerrar, CATEGORIAS: CATEGORIAS };
})();
