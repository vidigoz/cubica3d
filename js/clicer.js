/* Lógica del producto «Clicker de Nombre».
 *
 * En un clicker el nombre se arma con teclas: cada letra del nombre lleva TRES
 * piezas y cada pieza lleva su color (la base además lleva acabado):
 *   · la base  — color + acabado (Corrugado o Liso),
 *   · la tecla — color,
 *   · la letra — color de la letra impresa.
 * Todo se puede poner igual para el nombre entero (los menús «todas») o letra
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

  // Una sola palabra y sólo letras (acentos y Ñ incluidos): es lo que se puede
  // imprimir como tecla. Espacios, números y signos no son teclas.
  var SOLO_LETRAS = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/;

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

  // "Victor" -> { ok: true, nombre: "Victor", letras: ["V","I","C","T","O","R"] }
  // Si el nombre no sirve, devuelve ok:false con el motivo ya en castellano.
  function letrasDe(nombre) {
    var limpio = Utils.normalize(nombre);
    if (!limpio) return { ok: false, error: 'Escribe el nombre.', nombre: '', letras: [] };
    if (!SOLO_LETRAS.test(limpio)) {
      return {
        ok: false,
        error: 'El nombre tiene que ser una sola palabra, sólo con letras (sin espacios, números ni signos).',
        nombre: '',
        letras: []
      };
    }
    return { ok: true, error: '', nombre: limpio, letras: limpio.toUpperCase().split('') };
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
  // nombre, sus tres piezas con su color (y la base con su acabado). Va completo
  // porque es lo que se necesita para fabricar sin preguntar nada.
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

  window.Clicer = {
    ACABADOS: acabados(),
    PIEZAS: PIEZAS.map(function (p) { return { id: p.id, nombre: p.nombre }; }),
    PRECIOS_POR_DEFECTO: PRECIOS_POR_DEFECTO,
    acabados: acabados,
    buscarAcabado: buscarAcabado,
    letrasDe: letrasDe,
    alinear: alinear,
    piezasDe: piezasDe,
    preciosDe: preciosDe,
    precioDe: precioDe,
    detallesDe: detallesDe
  };
})();
