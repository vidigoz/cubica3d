/* Lógica del producto «Clicer de Nombre».
 *
 * Un clicer lleva base (con acabado corrugado o liso y de un solo color) y una
 * tecla por cada letra del nombre; cada tecla puede ser de un color distinto.
 * El precio sale de la configuración del negocio (Configuración → Precios), por
 * letra, con dos tramos: el corto hasta `letrasCorte` letras y el largo de ahí
 * en adelante.
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

  // Desglose que viaja al carrito, al tablero y al PDF: la base (color +
  // acabado) y una entrada por tecla con su letra y su color. Va completo
  // porque es lo que se necesita para fabricar.
  function detallesDe(opciones) {
    var o = opciones || {};
    var lista = [];
    if (o.base) {
      lista.push({
        label: 'Base',
        nombre: o.base.nombre + (o.acabado ? ' (' + o.acabado + ')' : ''),
        hex: o.base.hex
      });
    }
    (o.letras || []).forEach(function (letra, i) {
      var color = (o.teclas || [])[i];
      lista.push({
        label: 'Tecla ' + (i + 1) + ' (' + letra + ')',
        nombre: color ? color.nombre : '',
        hex: color ? color.hex : ''
      });
    });
    return lista;
  }

  window.Clicer = {
    ACABADOS: acabados(),
    PRECIOS_POR_DEFECTO: PRECIOS_POR_DEFECTO,
    acabados: acabados,
    buscarAcabado: buscarAcabado,
    letrasDe: letrasDe,
    preciosDe: preciosDe,
    precioDe: precioDe,
    detallesDe: detallesDe
  };
})();
