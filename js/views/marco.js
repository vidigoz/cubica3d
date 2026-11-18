/* Herramienta «Marco de fotos» (Herramientas → Marco de fotos, #/herramientas/marco).
 *
 * Es un marco de dos piezas —Bottom Frame y Top Frame— y lo único que se edita es el
 * nombre que lleva el Top Frame: texto, fuente, tamaño, curvatura y posición (ver
 * js/marco.js para la geometría). Aquí vive la pantalla:
 *   · los controles del texto;
 *   · una vista 2D desde arriba de las dos piezas, que se redibuja al instante;
 *   · la descarga de DOS STL: el Top (el marco con su nombre, en una sola pieza) y el
 *     Bottom (sin cambios). Los colores se asignan al imprimir (un STL no lleva color).
 * Todo se calcula en el navegador: los STL de stl/Frame/, las fuentes de fonts/marco/ y
 * las dos librerías de js/vendor/ (opentype.js para leer las fuentes y earcut para
 * triangular las letras) se piden sólo al abrir esta pantalla.
 * Se expone como window.Views.marco */
(function () {
  'use strict';

  var Utils = window.Utils;

  var FUENTES = [
    { id: 'Lobster', nombre: 'Lobster', archivo: 'Lobster-Regular.ttf' },
    { id: 'Pacifico', nombre: 'Pacifico', archivo: 'Pacifico-Regular.ttf' },
    { id: 'GreatVibes', nombre: 'Great Vibes (cursiva fina)', archivo: 'GreatVibes-Regular.ttf' },
    { id: 'Kaushan', nombre: 'Kaushan Script', archivo: 'KaushanScript-Regular.ttf' },
    { id: 'Cookie', nombre: 'Cookie', archivo: 'Cookie-Regular.ttf' },
    { id: 'Playball', nombre: 'Playball', archivo: 'Playball-Regular.ttf' },
    { id: 'Courgette', nombre: 'Courgette', archivo: 'Courgette-Regular.ttf' },
    { id: 'Bebas', nombre: 'Bebas Neue (mayúsculas)', archivo: 'BebasNeue-Regular.ttf' }
  ];

  // Los colores de la vista (sólo para verla; el STL no lleva color).
  var COLOR = { campo: '#dc2626', borde: '#ffffff', texto: '#ffffff', bottom: '#dc2626' };

  var PX_POR_MM = 2.8;

  var estado = {
    texto: 'Feliz navidad',
    fuente: 'Lobster',
    tamano: 13,
    radio: 37.5,
    apice: 129.65,
    giro: 0,
    cursiva: 0
  };

  var raiz = null;          // el contenedor de la vista
  var modelo = null;        // { cuerpo, bottomTris, bottomBytes, tapas, tapasBottom }
  var libs = null;          // promesa de las librerías
  var fuentes = {};         // id -> fuente de opentype.js ya leída
  var texto = null;         // la malla del texto actual { tris, faltan, letras }
  var pendiente = 0;        // para ignorar respuestas viejas

  /* --------------------------------- Carga --------------------------------- */

  function cargarScript(src) {
    return new Promise(function (resolver, rechazar) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolver;
      s.onerror = function () { rechazar(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }

  function cargarLibrerias() {
    if (!libs) {
      libs = cargarScript('js/vendor/opentype.min.js')
        .then(function () { return cargarScript('js/vendor/earcut.min.js'); })
        .then(function () { return cargarScript('js/marco.js'); });
    }
    return libs;
  }

  function pedirBuffer(url) {
    return fetch(encodeURI(url)).then(function (r) {
      if (!r.ok) throw new Error('No se pudo cargar ' + url + ' (' + r.status + ')');
      return r.arrayBuffer();
    });
  }

  function cargarModelo() {
    if (modelo) return Promise.resolve(modelo);
    return Promise.all([pedirBuffer('stl/Frame/Top Frame.stl'), pedirBuffer('stl/Frame/Bottom Frame.stl')]).then(function (bufs) {
      var M = window.Marco;
      var cuerpo = M.cuerpoDelMarco(M.leerSTL(bufs[0]));
      var bottom = M.leerSTL(bufs[1]);
      modelo = {
        cuerpo: cuerpo,
        bottomTris: bottom,
        bottomBytes: bufs[1],
        tapas: tapasArriba(cuerpo),
        tapasBottom: tapasArriba(bottom)
      };
      return modelo;
    });
  }

  // Los triángulos horizontales que miran hacia arriba, agrupados por altura (z):
  // son lo que se ve desde arriba y lo que pinta la vista 2D.
  function tapasArriba(tri) {
    var porZ = {};
    for (var i = 0; i < tri.length; i += 9) {
      var z = tri[i + 2];
      if (Math.abs(z - tri[i + 5]) > 1e-4 || Math.abs(z - tri[i + 8]) > 1e-4) continue;
      var nz = (tri[i + 3] - tri[i]) * (tri[i + 7] - tri[i + 1]) - (tri[i + 4] - tri[i + 1]) * (tri[i + 6] - tri[i]);
      if (nz <= 0) continue;
      var clave = z.toFixed(2);
      (porZ[clave] = porZ[clave] || { z: z, tris: [] }).tris.push(tri.subarray(i, i + 9));
    }
    return Object.keys(porZ).map(function (k) { return porZ[k]; }).sort(function (a, b) { return a.z - b.z; });
  }

  function cargarFuente(id) {
    if (fuentes[id]) return Promise.resolve(fuentes[id]);
    var f = FUENTES.filter(function (x) { return x.id === id; })[0] || FUENTES[0];
    return pedirBuffer('fonts/marco/' + f.archivo).then(function (buf) {
      fuentes[id] = window.opentype.parse(buf);
      return fuentes[id];
    });
  }

  /* --------------------------------- Pantalla --------------------------------- */

  function campoRango(clave, rotulo, min, max, paso, ayuda) {
    return '' +
      '<label class="field">' +
        '<span class="field__label">' + rotulo + ' <b class="marco__valor" data-valor="' + clave + '"></b></span>' +
        '<input class="marco__rango" type="range" data-rango="' + clave + '" min="' + min + '" max="' + max + '" step="' + paso + '" value="' + estado[clave] + '" />' +
        (ayuda ? '<span class="field__opt">' + ayuda + '</span>' : '') +
      '</label>';
  }

  function render(container) {
    raiz = container;

    raiz.innerHTML = '' +
      '<div class="page marco">' +
        '<div class="page__head">' +
          '<button class="btn btn--ghost btn--back" type="button" data-volver>← Herramientas</button>' +
          '<h2 class="page__title">Marco de fotos</h2>' +
          '<p class="page__subtitle">Escribe el nombre; la vista es el marco tal como se va a imprimir.</p>' +
        '</div>' +
        '<p class="alert alert--warn" data-estado>Cargando el marco…</p>' +
        '<div class="marco__cuerpo">' +
          '<section class="panel marco__panel">' +
            '<h3 class="panel__title">Nombre</h3>' +
            '<label class="field">' +
              '<span class="field__label">Lo que dice</span>' +
              '<input class="field__input" type="text" data-texto maxlength="40" autocomplete="off" value="' + Utils.escapeHtml(estado.texto) + '" />' +
            '</label>' +
            '<label class="field">' +
              '<span class="field__label">Fuente</span>' +
              '<select class="field__input" data-fuente>' + FUENTES.map(function (f) {
                return '<option value="' + f.id + '"' + (f.id === estado.fuente ? ' selected' : '') + '>' + Utils.escapeHtml(f.nombre) + '</option>';
              }).join('') + '</select>' +
            '</label>' +
            campoRango('tamano', 'Tamaño', 6, 22, 0.5, 'Alto de las letras en mm.') +
            campoRango('radio', 'Curvatura', 20, 200, 1, 'Radio del arco: más chico = más curvo, más grande = más recto.') +
            campoRango('apice', 'Posición', 118, 138, 0.5, 'Acerca el texto a la ventana (menos) o al borde (más).') +
            campoRango('giro', 'Girar por el arco', -35, 35, 0.5, 'Corre el texto hacia un lado, en grados.') +
            campoRango('cursiva', 'Inclinación', 0, 0.4, 0.01, 'Para fuentes que no son cursivas.') +
            '<p class="field__opt" data-aviso-texto hidden></p>' +
          '</section>' +
          '<section class="panel marco__vistas">' +
            '<h3 class="panel__title">Vista desde arriba</h3>' +
            '<div class="marco__lienzos">' +
              '<figure class="marco__fig"><canvas data-vista="top"></canvas><figcaption>Top frame</figcaption></figure>' +
              '<figure class="marco__fig"><canvas data-vista="bottom"></canvas><figcaption>Bottom frame</figcaption></figure>' +
            '</div>' +
            '<h3 class="panel__title">Descargar STL</h3>' +
            '<div class="marco__descargas">' +
              '<button class="btn btn--primary" type="button" data-bajar="todo">Descargar los 2 STL</button>' +
              '<button class="btn" type="button" data-bajar="top">Top frame (con el nombre)</button>' +
              '<button class="btn" type="button" data-bajar="bottom">Bottom frame</button>' +
            '</div>' +
            '<p class="field__opt marco__ayuda" data-ayuda></p>' +
          '</section>' +
        '</div>' +
      '</div>';

    bind();
    pintarValores();

    cargarLibrerias().then(cargarModelo).then(function () {
      return cargarFuente(estado.fuente);
    }).then(function () {
      var e = raiz && raiz.querySelector('[data-estado]');
      if (e) e.hidden = true;
      regenerar();
    }, function (error) {
      var e = raiz && raiz.querySelector('[data-estado]');
      if (e) { e.hidden = false; e.textContent = 'No se pudo cargar la herramienta: ' + error.message; }
    });
  }

  /* --------------------------------- Interacción --------------------------------- */

  function pintarValores() {
    if (!raiz) return;
    var unidades = { tamano: ' mm', radio: ' mm', apice: '', giro: '°', cursiva: '' };
    Object.keys(unidades).forEach(function (k) {
      var el = raiz.querySelector('[data-valor="' + k + '"]');
      if (el) el.textContent = estado[k] + unidades[k];
    });
  }

  function bind() {
    raiz.addEventListener('click', function (e) {
      if (e.target.closest('[data-volver]')) { window.App.navigate('herramientas'); return; }
      var b = e.target.closest('[data-bajar]');
      if (b) descargar(b.getAttribute('data-bajar'));
    });

    raiz.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches('[data-texto]')) { estado.texto = t.value; regenerar(); return; }
      var r = t.closest('[data-rango]');
      if (r) {
        estado[r.getAttribute('data-rango')] = parseFloat(r.value);
        pintarValores();
        regenerar();
      }
    });

    raiz.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-fuente]')) {
        estado.fuente = t.value;
        cargarFuente(estado.fuente).then(regenerar, function (error) { window.App.toast(error.message, 'error'); });
        return;
      }
    });
  }

  /* --------------------------------- Texto y dibujo --------------------------------- */

  function regenerar() {
    if (!modelo || !fuentes[estado.fuente]) return;
    var M = window.Marco;
    texto = M.textoEnArco(fuentes[estado.fuente], estado.texto, {
      tamano: estado.tamano,
      radio: estado.radio,
      apice: estado.apice,
      giro: estado.giro,
      cursiva: estado.cursiva
    }, window.earcut);

    var aviso = raiz && raiz.querySelector('[data-aviso-texto]');
    if (aviso) {
      var caja = texto.tris.length ? M.cajaDe(texto.tris) : null;
      var msgs = [];
      if (texto.faltan.length) msgs.push('Esta fuente no tiene: ' + texto.faltan.join(' ') + ' (no se imprimirá).');
      // el texto se sale del marco si toca el reborde (x ≈ 141.5) o la ventana (x ≈ 119.9 en el centro)
      if (caja && (caja.y0 < 4 || caja.y1 > 84.5 || caja.x1 > 140.5)) msgs.push('El texto se sale del marco: redúcelo o acércalo a la ventana.');
      aviso.textContent = msgs.join(' ');
      aviso.hidden = !msgs.length;
    }
    var ayuda = raiz && raiz.querySelector('[data-ayuda]');
    if (ayuda) {
      ayuda.textContent = 'El Top frame sale en un solo STL, con el nombre ya puesto; el Bottom frame es el de siempre. ' +
        'Los colores (campo, borde y nombre) se asignan en Bambu Studio.';
    }
    dibujar();
  }

  // Dibuja los triángulos (cada uno como [x0,y0,z0, x1,y1,z1, x2,y2,z2]) con la pantalla
  // girada: derecha = +Y, abajo = +X. Con un trazo delgado del mismo color para que no
  // se vean las costuras entre triángulos.
  function pintarTriangulos(ctx, tris, color, dx, dy) {
    ctx.beginPath();
    tris.forEach(function (t) {
      ctx.moveTo(t[1] * PX_POR_MM + dx, t[0] * PX_POR_MM + dy);
      ctx.lineTo(t[4] * PX_POR_MM + dx, t[3] * PX_POR_MM + dy);
      ctx.lineTo(t[7] * PX_POR_MM + dx, t[6] * PX_POR_MM + dy);
      ctx.closePath();
    });
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    ctx.fill();
    ctx.stroke();
  }

  function preparar(canvas, ancho, alto) {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(ancho * dpr);
    canvas.height = Math.round(alto * dpr);
    canvas.style.width = ancho + 'px';
    canvas.style.height = alto + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ancho, alto);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, ancho, alto);
    return ctx;
  }

  // Oscurece un color según la altura: lo más bajo se ve más oscuro.
  function sombrear(hex, factor) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    if (!isFinite(n)) return hex;
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * factor) + ',' + Math.round(g * factor) + ',' + Math.round(b * factor) + ')';
  }

  // El Top frame visto desde arriba: el campo a z = 4, el reborde a z = 5 y el nombre.
  //   col = { campo, borde, texto } (colores hex)
  function dibujarTop(canvas, malla, col) {
    var M = window.Marco;
    var pad = 10;
    var caja = M.cajaDe(modelo.cuerpo);
    var ctx = preparar(canvas, (caja.y1 - caja.y0) * PX_POR_MM + pad * 2, (caja.x1 - caja.x0) * PX_POR_MM + pad * 2);
    modelo.tapas.forEach(function (nivel) {
      pintarTriangulos(ctx, nivel.tris, nivel.z > 4.5 ? col.borde : col.campo, pad, pad);
    });
    if (malla && malla.tris.length) {
      var arriba = tapasArriba(malla.tris);
      var tope = arriba.length ? arriba[arriba.length - 1].tris : [];
      pintarTriangulos(ctx, tope, 'rgba(15,23,42,.35)', pad + 1.2, pad + 1.2);   // la sombra del relieve
      pintarTriangulos(ctx, tope, col.texto, pad, pad);
    }
  }

  function dibujar() {
    if (!raiz || !modelo) return;
    var M = window.Marco;
    var pad = 10;
    dibujarTop(raiz.querySelector('[data-vista="top"]'), texto, { campo: COLOR.campo, borde: COLOR.borde, texto: COLOR.texto });

    // Bottom frame: sus niveles, del más bajo al más alto, más oscuros mientras más abajo
    var cBot = raiz.querySelector('[data-vista="bottom"]');
    var cajaBot = M.cajaDe(modelo.bottomTris);
    var ctx2 = preparar(cBot, (cajaBot.y1 - cajaBot.y0) * PX_POR_MM + pad * 2, (cajaBot.x1 - cajaBot.x0) * PX_POR_MM + pad * 2);
    modelo.tapasBottom.forEach(function (nivel) {
      var factor = 0.72 + 0.28 * (nivel.z / cajaBot.z1);
      pintarTriangulos(ctx2, nivel.tris, sombrear(COLOR.bottom, factor), pad, pad);
    });
  }

  // Para el producto «Marco de fotos» (Productos): dibuja el Top frame con ese nombre,
  // esa fuente y esos dos colores en un canvas. El tamaño de letra se ajusta solo para
  // que el nombre quepa. Devuelve una promesa con { tamano, faltan }.
  //   op = { texto, fuente (id de FUENTES), pieza: '#hex', marco: '#hex' }
  function vistaProducto(canvas, op) {
    return cargarLibrerias().then(cargarModelo).then(function () {
      return cargarFuente(op.fuente);
    }).then(function (fuente) {
      var M = window.Marco;
      var tamano = M.tamanoAjustado(fuente, op.texto);
      var malla = M.textoEnArco(fuente, op.texto, { tamano: tamano, radio: 37.5, apice: 129.65 }, window.earcut);
      dibujarTop(canvas, malla, { campo: op.pieza, borde: op.marco, texto: op.marco });
      return { tamano: tamano, faltan: malla.faltan };
    });
  }

  /* --------------------------------- Descarga --------------------------------- */

  function bajar(nombre, buffer) {
    var url = URL.createObjectURL(new Blob([buffer], { type: 'model/stl' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function descargar(cual) {
    if (!modelo || !texto) { window.App.toast('Espera a que cargue el marco.', 'error'); return; }
    var M = window.Marco;
    var piezas = {
      'top': ['marco-top.stl', function () {
        // el marco con su nombre, en una sola pieza (el nombre queda incrustado en el campo)
        var junto = new Float32Array(modelo.cuerpo.length + texto.tris.length);
        junto.set(modelo.cuerpo, 0);
        junto.set(texto.tris, modelo.cuerpo.length);
        return M.escribirSTL(junto, 'Marco top');
      }],
      'bottom': ['marco-bottom.stl', function () { return modelo.bottomBytes; }]
    };
    var lista = cual === 'todo' ? ['top', 'bottom'] : [cual];
    if (!texto.tris.length && lista.indexOf('top') >= 0) {
      window.App.toast('El Top frame sale sin nombre (el texto está vacío).');
    }
    lista.forEach(function (k, i) {
      setTimeout(function () { bajar(piezas[k][0], piezas[k][1]()); }, i * 450);
    });
    if (lista.length) window.App.toast(lista.length === 1 ? 'STL descargado' : lista.length + ' STL descargados');
  }

  window.Views = window.Views || {};
  window.Views.marco = { render: render, vistaProducto: vistaProducto, FUENTES: FUENTES };
})();
