/* Lógica del producto «Charm para Silla».
 *
 * Un charm para silla se arma con piezas: cada letra, número o símbolo del texto
 * («Alejandro Perez #11») es una pieza BICOLOR —una base de un color y una tapa
 * de otro— y además se le pueden sumar charms sueltos («pelota de volly»), todos
 * los que se quiera. Es parecido al clicker pero sin teclas, y el texto puede
 * llevar espacios, números y signos (los espacios separan, no son pieza).
 * Todo se puede poner igual para el texto entero (los menús «todas») o pieza por
 * pieza.
 *
 * El precio es FIJO (Configuración → Precios, $350 de inicio): no cambia con las
 * piezas del texto ni con los charms que se sumen.
 *
 * Vive aparte de la vista para que el precio y el desglose se calculen en un solo
 * lugar. Se expone como window.Charm */
(function () {
  'use strict';

  var Utils = window.Utils;

  var TEXTO_MAX = 40;      // piezas del texto (sin contar espacios)
  var CHARM_MAX = 100;     // largo del nombre de un charm suelto

  // Si la base todavía no tiene el precio del charm (una base vieja), se usa éste.
  var PRECIO_POR_DEFECTO = 350;

  // El precio fijo tal como quedó en Configuración.
  function precioFijo(config) {
    var c = (config && config.precios && config.precios.charm) || {};
    return Math.max(0, Utils.parseNumber(c.precio, PRECIO_POR_DEFECTO));
  }

  // "Alejandro  Perez #11" -> { ok: true, texto: "Alejandro Perez #11",
  //   piezas: ["A","L","E",…,"#","1","1"] }
  // Los espacios no son pieza; el · se quita porque es el que separa la pieza de su
  // rótulo («A · Base») y confundiría al leer el desglose de vuelta.
  function piezasDe(valor) {
    var texto = String(valor == null ? '' : valor).replace(/[··]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!texto) return { ok: false, error: 'Escribe el nombre o el texto del charm.', texto: '', piezas: [] };
    var piezas = Array.from(texto).filter(function (c) { return !/\s/.test(c); })
      .map(function (c) { return c.toUpperCase(); });
    if (piezas.length > TEXTO_MAX) {
      return { ok: false, error: 'El texto no puede pasar de ' + TEXTO_MAX + ' letras, números o símbolos.', texto: '', piezas: [] };
    }
    return { ok: true, error: '', texto: texto, piezas: piezas };
  }

  // Cuánto sale: el precio fijo, lleve las piezas y los charms que lleve.
  function precioDe(config) {
    return { total: Math.round(precioFijo(config) * 100) / 100 };
  }

  // Alinea una lista de elecciones con las piezas que hay ahora en el campo: lo ya
  // elegido se conserva por posición y lo que falta toma el valor de «todas».
  function alinear(cantidad, elegidas, porDefecto) {
    var lista = [];
    var previas = elegidas || [];
    for (var i = 0; i < cantidad; i++) {
      var valor = previas[i];
      lista.push(valor == null || valor === '' ? porDefecto : valor);
    }
    return lista;
  }

  // Desglose que viaja al carrito, al tablero y al PDF: por CADA pieza su base y su
  // tapa con su color, y luego los charms sueltos (sin color: sólo su nombre).
  //   piezas: [{ caracter, base: <color>, tapa: <color> }] · charms: ['pelota de volly']
  function detallesDe(piezas, charms) {
    var lista = [];
    (piezas || []).forEach(function (p) {
      var pieza = p || {};
      lista.push({ label: pieza.caracter + ' · Base', nombre: pieza.base ? pieza.base.nombre : '', hex: pieza.base ? pieza.base.hex : '' });
      lista.push({ label: pieza.caracter + ' · Tapa', nombre: pieza.tapa ? pieza.tapa.nombre : '', hex: pieza.tapa ? pieza.tapa.hex : '' });
    });
    (charms || []).forEach(function (nombre) {
      lista.push({ label: 'Charm', nombre: nombre, hex: '' });
    });
    return lista;
  }

  window.Charm = {
    TEXTO_MAX: TEXTO_MAX,
    CHARM_MAX: CHARM_MAX,
    PRECIO_POR_DEFECTO: PRECIO_POR_DEFECTO,
    precioFijo: precioFijo,
    piezasDe: piezasDe,
    precioDe: precioDe,
    alinear: alinear,
    detallesDe: detallesDe
  };
})();
