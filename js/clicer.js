/* Lógica del producto «Clicker de Nombre».
 *
 * En un clicker el nombre se arma con teclas: cada letra del nombre lleva TRES
 * piezas y cada pieza lleva su color (la base además lleva acabado):
 *   · la base  — color + acabado (Corrugado o Liso),
 *   · la tecla — color,
 *   · la letra — color de la letra impresa.
 * A la última letra del nombre se le puede sumar UN símbolo escrito a mano
 * («estrella», «corazón»…): es una tecla más —lleva sus tres piezas y cuenta
 * como una letra en el precio— pero NO se mapea a ningún carácter, se fabrica
 * tal como se lee (ver simboloDe).
 * El nombre también puede llevar emojis: cada uno es una letra más (misma tecla, mismo
 * precio por letra). Todo se puede poner igual para el nombre entero (los menús «todas») o letra
 * por letra. El precio sale de la configuración del negocio (Configuración →
 * Precios), por letra, con dos tramos: el corto hasta `letrasCorte` letras y el
 * largo de ahí en adelante.
 *
 * Vive aparte de la vista para que el precio y el desglose se calculen en un
 * solo lugar y se puedan probar sin navegador (ver __prueba-clicer.mjs).
 * Se expone como window.Clicer */
(function () {
  'use strict';

  var Utils = window.Utils;

  // El nombre se parte en «letras», una por tecla. Una letra es una letra de verdad
  // (acentos y Ñ incluidos), un NÚMERO o un EMOJI, y el emoji cuenta como una letra más: lleva sus
  // tres piezas y paga el mismo precio por letra. Un emoji puede ser varios caracteres
  // (con su variante, un tono de piel, una bandera o varios unidos: 👨‍👩‍👧), por eso se
  // reconoce la secuencia entera y no carácter por carácter. Espacios y
  // signos no son teclas.
  var PIEZA = new RegExp('(' + Utils.EMOJI + ')|([A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ])|([^])', 'gu');

  // El símbolo es la tecla que se escribe a mano («estrella», «corazón», «logo»):
  // no se mapea a ningún carácter, así que no tiene que ser una letra. Sólo se
  // limpia —se le saca el · (que separa el carácter de la pieza en los rótulos)
  // y se enderezan los espacios— y se acota el largo para que el rótulo y el
  // título de la línea entren en los límites del API.
  var SIMBOLO_MAX = 24;

  // Acabados de la base. Son del producto (no se cotizan distinto); el color sí
  // sale del stock de colores y se elige al cotizar.
  var ACABADOS = [
    { id: 'corrugado', nombre: 'Corrugado' },
    { id: 'liso', nombre: 'Liso' }
  ];

  // Las tres piezas que lleva CADA letra del nombre, en el orden en que se
  // eligen (y en el que salen en el desglose): la base con su acabado, la tecla
  // y la letra.
  var PIEZAS = [
    { id: 'base', nombre: 'Base' },
    { id: 'tecla', nombre: 'Tecla' },
    { id: 'letra', nombre: 'Letra' }
  ];

  // Si la base todavía no tiene precios de clicer (una base vieja, sin esta
  // configuración), se usan estos: mismo criterio que el resto de la config.
  var PRECIOS_POR_DEFECTO = { porLetraCorto: 15, porLetraLargo: 30, letrasCorte: 5 };

  function acabados() {
    return ACABADOS.map(function (a) { return { id: a.id, nombre: a.nombre }; });
  }

  function buscarAcabado(id) {
    for (var i = 0; i < ACABADOS.length; i++) {
      if (ACABADOS[i].id === id) return ACABADOS[i];
    }
    return null;
  }

  // El símbolo tal como se va a fabricar: '' si no escribieron ninguno.
  //   simboloDe('  Estrella  ') -> { ok: true, texto: 'Estrella' }
  //   simboloDe('')            -> { ok: true, texto: '' }   (sin símbolo)
  //   simboloDe('a · b')       -> { ok: true, texto: 'a b' } (el · es del rótulo)
  function simboloDe(valor) {
    var limpio = String(valor == null ? '' : valor)
      .replace(/[\u00b7·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!limpio) return { ok: true, texto: '', error: '' };
    if (limpio.length > SIMBOLO_MAX) {
      return {
        ok: false,
        texto: '',
        error: 'El símbolo no puede pasar de ' + SIMBOLO_MAX + ' caracteres.'
      };
    }
    return { ok: true, texto: limpio, error: '' };
  }

  // "Victor" -> { ok: true, nombre: "Victor", letras: ["V","I","C","T","O","R"] }
  // Con símbolo, la última «letra» es el símbolo escrito a mano, así que el
  // nombre y el precio lo cuentan como una más:
  //   letrasDe("Ana", "estrella") -> letras ["A","N","A","estrella"], 4 letras
  // `indiceSimbolo` dice cuál es (-1 cuando no hay), que es lo que la vista usa
  // para marcar esa fila. Si el nombre no sirve, devuelve ok:false con el motivo
  // ya en castellano.
  function letrasDe(nombre, simbolo) {
    var limpio = Utils.normalize(nombre);
    var sim = simboloDe(simbolo);
    if (!sim.ok) return { ok: false, error: sim.error, nombre: '', letras: [], simbolo: '', indiceSimbolo: -1 };
    if (!limpio) return { ok: false, error: 'Escribe el nombre.', nombre: '', letras: [], simbolo: '', indiceSimbolo: -1 };
    // Se parte en letras y emojis; cualquier otra cosa (espacio, signo) no sirve.
    limpio = limpio.normalize('NFC');
    var letras = [];
    var invalido = false;
    limpio.replace(PIEZA, function (todo, emoji, letra) {
      if (emoji) letras.push(emoji);
      else if (letra) letras.push(letra.toUpperCase());
      else invalido = true;
      return todo;
    });
    if (invalido) {
      return {
        ok: false,
        error: 'El nombre tiene que ser una sola palabra, sólo con letras, números y emojis (sin espacios ni signos).',
        nombre: '',
        letras: [],
        simbolo: '',
        indiceSimbolo: -1
      };
    }
    var indiceSimbolo = -1;
    if (sim.texto) {
      indiceSimbolo = letras.length;
      letras.push(sim.texto);
    }
    return {
      ok: true,
      error: '',
      nombre: limpio,
      letras: letras,
      simbolo: sim.texto,
      indiceSimbolo: indiceSimbolo
    };
  }

  // Los precios del clicer tal como quedaron en Configuración.
  function preciosDe(config) {
    var c = (config && config.precios && config.precios.clicer) || {};
    return {
      porLetraCorto: Utils.parseNumber(c.porLetraCorto, PRECIOS_POR_DEFECTO.porLetraCorto),
      porLetraLargo: Utils.parseNumber(c.porLetraLargo, PRECIOS_POR_DEFECTO.porLetraLargo),
      letrasCorte: Utils.parseNumber(c.letrasCorte, PRECIOS_POR_DEFECTO.letrasCorte)
    };
  }

  // Cuánto sale UN clicer de `cantidad` letras. El tramo largo arranca en
  // letrasCorte + 1 (con el corte en 5: hasta 5 letras, precio corto).
  function precioDe(config, cantidad) {
    var p = preciosDe(config);
    var letras = Math.max(0, Math.floor(Utils.parseNumber(cantidad, 0)));
    var largo = letras > p.letrasCorte;
    var porLetra = largo ? p.porLetraLargo : p.porLetraCorto;
    return {
      letras: letras,
      porLetra: porLetra,
      largo: largo,
      letrasCorte: p.letrasCorte,
      total: Math.round(porLetra * letras * 100) / 100
    };
  }

  // Alinea una lista de elecciones (colores o acabados) con las letras que hay
  // ahora en el campo: lo ya elegido se conserva por posición y lo que falta
  // toma el valor de «todas» (el menú que vale para el nombre entero).
  function alinear(cantidad, elegidas, porDefecto) {
    var lista = [];
    var previas = elegidas || [];
    for (var i = 0; i < cantidad; i++) {
      var valor = previas[i];
      lista.push(valor == null || valor === '' ? porDefecto : valor);
    }
    return lista;
  }

  // Arma las piezas del nombre, una por letra:
  //   { caracter: 'A', base: <color>, acabado: 'Corrugado', tecla: <color>, letra: <color> }
  // `eleccion` trae una lista por pieza —{ base, acabado, tecla, letra }— ya
  // alineada con las letras (ver alinear). Es la forma en la que la vista tiene
  // todo lo elegido antes de armar el desglose.
  function piezasDe(letras, eleccion) {
    var e = eleccion || {};
    return (letras || []).map(function (caracter, i) {
      return {
        caracter: caracter,
        base: (e.base || [])[i] || null,
        acabado: (e.acabado || [])[i] || '',
        tecla: (e.tecla || [])[i] || null,
        letra: (e.letra || [])[i] || null
      };
    });
  }

  // "Negro (Corrugado)": el color de la base con su acabado, que es como se
  // pide al proveedor.
  function nombreConAcabado(color, acabado) {
    if (!color) return acabado || '';
    return color.nombre + (acabado ? ' (' + acabado + ')' : '');
  }

  // Desglose que viaja al carrito, al tablero y al PDF: por CADA letra del
  // nombre —y el símbolo, si lo hay, que entra como una letra más— sus tres
  // piezas con su color (y la base con su acabado). Va completo porque es lo que
  // se necesita para fabricar sin preguntar nada.
  function detallesDe(piezas) {
    var lista = [];
    (piezas || []).forEach(function (p) {
      var pieza = p || {};
      var caracter = pieza.caracter || '';
      lista.push({
        label: caracter + ' · Base',
        nombre: nombreConAcabado(pieza.base, pieza.acabado),
        hex: pieza.base ? pieza.base.hex : ''
      });
      lista.push({
        label: caracter + ' · Tecla',
        nombre: pieza.tecla ? pieza.tecla.nombre : '',
        hex: pieza.tecla ? pieza.tecla.hex : ''
      });
      lista.push({
        label: caracter + ' · Letra',
        nombre: pieza.letra ? pieza.letra.nombre : '',
        hex: pieza.letra ? pieza.letra.hex : ''
      });
    });
    return lista;
  }

  // La imagen del clicker tal como va a quedar: una tecla por letra, con su base, su tecla
  // y su letra cada una de su color; si la base es corrugada, con sus olanes alrededor.
  // Sirve para la cotización (formulario y hoja).
  //   piezas: [{ caracter, base: { hex }, tecla: { hex }, letra: { hex }, corrugado: bool }]
  // Cada tecla es un SVG (sale igual en pantalla y al imprimir); su tamaño sale del
  // font-size de .ck-fila en css/styles.css.
  var OLANES = 36;   // cuántos olanes lleva una base corrugada

  // Los centros de los olanes: puntos repartidos a lo largo de un cuadrado de esquinas
  // redondas (x, y, lado y radio de esquina en el viewBox de 100).
  function puntosDeOlanes(x, y, lado, r, n) {
    var recto = lado - 2 * r;
    var arco = Math.PI * r / 2;
    var tramos = [recto, arco, recto, arco, recto, arco, recto, arco];
    var total = 4 * recto + 4 * arco;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var d = (i + 0.5) * total / n;
      var t = 0;
      while (d > tramos[t]) { d -= tramos[t]; t++; }
      var px, py;
      var cx = [x + lado - r, x + lado - r, x + r, x + r];   // centros de las esquinas: arriba-der., abajo-der., abajo-izq., arriba-izq.
      var cy = [y + r, y + lado - r, y + lado - r, y + r];
      if (t % 2 === 0) {                                      // tramo recto: arriba, derecha, abajo, izquierda
        var k = t / 2;
        if (k === 0) { px = x + r + d; py = y; }
        else if (k === 1) { px = x + lado; py = y + r + d; }
        else if (k === 2) { px = x + lado - r - d; py = y + lado; }
        else { px = x; py = y + lado - r - d; }
      } else {                                                // esquina: el ángulo avanza 90°
        var e = (t - 1) / 2;
        var ang = (-90 + e * 90 + (d / arco) * 90) * Math.PI / 180;
        px = cx[e] + r * Math.cos(ang);
        py = cy[e] + r * Math.sin(ang);
      }
      pts.push([px, py]);
    }
    return pts;
  }

  function vistaHtml(piezas) {
    var esc = Utils.escapeHtml;
    var color = function (c, otro) { return c && c.hex ? esc(c.hex) : otro; };
    var olanes = puntosDeOlanes(9, 9, 82, 16, OLANES);
    return '<span class="ck-fila" aria-hidden="true">' + (piezas || []).map(function (p) {
      var caracter = String(p.caracter || '');
      var chica = Array.from(caracter).length > 2;
      var base = color(p.base, '#cccccc');
      return '<svg class="ck" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
        (p.corrugado
          ? '<g fill="' + base + '" stroke="rgba(0,0,0,.28)" stroke-width="1">' + olanes.map(function (o) {
              return '<circle cx="' + o[0].toFixed(1) + '" cy="' + o[1].toFixed(1) + '" r="3.6"/>';
            }).join('') + '</g>'
          : '') +
        '<rect x="9" y="9" width="82" height="82" rx="16" fill="' + base + '" stroke="rgba(0,0,0,.28)" stroke-width="1"/>' +
        (p.corrugado ? '<rect x="12" y="12" width="76" height="76" rx="13" fill="' + base + '"/>' : '') +
        '<rect x="22" y="22" width="56" height="56" rx="11" fill="' + color(p.tecla, '#eeeeee') + '" stroke="rgba(0,0,0,.25)" stroke-width="1"/>' +
        '<text x="50" y="51" text-anchor="middle" dominant-baseline="central" ' +
          'font-family="Arial Rounded MT Bold, Nunito, Segoe UI, Arial, sans-serif" font-weight="900" ' +
          'font-size="' + (chica ? 22 : 38) + '" fill="' + color(p.letra, '#111111') + '" ' +
          'stroke="rgba(0,0,0,.45)" stroke-width="1" paint-order="stroke">' + esc(caracter) + '</text>' +
      '</svg>';
    }).join('') + '</span>';
  }

  window.Clicer = {
    vistaHtml: vistaHtml,
    ACABADOS: acabados(),
    PIEZAS: PIEZAS.map(function (p) { return { id: p.id, nombre: p.nombre }; }),
    PRECIOS_POR_DEFECTO: PRECIOS_POR_DEFECTO,
    SIMBOLO_MAX: SIMBOLO_MAX,
    acabados: acabados,
    buscarAcabado: buscarAcabado,
    letrasDe: letrasDe,
    simboloDe: simboloDe,
    alinear: alinear,
    piezasDe: piezasDe,
    preciosDe: preciosDe,
    precioDe: precioDe,
    detallesDe: detallesDe
  };
})();
