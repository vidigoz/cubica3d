/* Estadísticas del taller: lo que se fabricó y lo que se vendió.
 *
 * Las dos preguntas que contesta este archivo, mirando el tablero que ya está
 * cargado (window.Proceso.getTarjetas()), sin pedirle nada más al servidor:
 *
 *   1) PRODUCCIÓN — de las tarjetas que YA pasaron por el taller, o sea las que
 *      están de «Realizado» en adelante (en «Cotización» y en «Trabajo» todavía
 *      no se fabricó nada: ahí no se cuenta), se cuentan las PIEZAS que salieron,
 *      mes por mes y en total:
 *        · del clicker: una BASE, una TECLA y una LETRA por cada letra del
 *          nombre (y de cada letra, su color);
 *        · del llavero: la BASE (el cuerpo) y el NOMBRE impreso, uno de cada uno
 *          por unidad.
 *      De cada pieza queda el ranking de colores, del más usado al menos: eso es
 *      lo que dice qué material es prioridad tener en stock. Las bases del
 *      clicker se cuentan con su acabado —«Negro (Corrugado)» no es la misma
 *      tanda que «Negro»— porque es material distinto en la impresora.
 *
 *   2) VENTAS — de las tarjetas con «Pagado» tildado, estén en la columna que
 *      estén (el tilde dice que se cobró; la columna dice dónde está la tarjeta),
 *      la plata que entró: en total y mes por mes.
 *
 * El MES de una tarjeta es el de su FECHA (la de la cotización, la que sale
 * impresa en el PDF). No se usa `movida` a propósito: esa cambia cuando se
 * corrige el nombre del cliente desde el tablero, así que una tarjeta podría
 * saltar de mes sola. Una tarjeta sin fecha usable cae en el cajón «Sin fecha»,
 * que va al final de la lista.
 *
 * El charm para silla cuenta una BASE y una TAPA por cada letra, número o símbolo
 * de su texto, cada una con su color (los charms sueltos no llevan color).
 *
 * La cotización manual no tiene piezas propias, pero puede anotar «colores usados»:
 * se tabulan en su propia cuenta («manual-colores») y no suman a las otras cinco.
 *
 * Las piezas se leen con las MISMAS reglas de la orden de producción
 * (window.PO): el rótulo del detalle dice la pieza («A · Base»), el clicker
 * viene de a tres detalles por letra —base, tecla y letra— y el llavero es base
 * → nombre. Un clicker viejo (de cuando el desglose traía «Base» y «Nombre») no
 * dice cuáles eran sus teclas ni sus letras: no se cuenta y se informa cuántas
 * líneas quedaron afuera (leer().cuenta.sinReceta), en vez de inventar piezas
 * que no se saben.
 *
 * Es sólo cuenta: no toca la base, no toca precios y no necesita navegador. Se
 * prueba con __prueba-estadisticas.mjs y lo pinta js/views/estadisticas.js.
 * Se expone como window.Estadisticas.
 *
 * leer(tarjetas) devuelve:
 *   {
 *     columnas:  ['realizado', 'entregado'],      // de dónde se cuenta
 *     cuenta:    { tarjetas: 2, unidades: 2, sinReceta: 0 },
 *     meses:     [ { mes: '2026-10', etiqueta: 'octubre 2026' } ],   // cronológico
 *     elementos: [ { id, tipo, pieza, etiqueta, nota, total,
 *                    colores: [ { nombre, hex, cantidad, parte } ],
 *                    meses:   [ { mes, etiqueta, cantidad, colores } ] } ],
 *     ventas:    { total, unidades, tarjetas, mejor: {mes, etiqueta, total} | null,
 *                  meses: [ { mes, etiqueta, total, unidades, tarjetas } ] },
 *     vacia:     false    // ¿todavía no hay ninguna tarjeta contada?
 *   }
 * `parte` es la proporción (0 a 1) de ese color dentro de su propia cuenta, que
 * es lo que dibuja la barrita del ranking. */
(function () {
  'use strict';

  var Utils = window.Utils;
  var PO = window.PO;

  // De dónde se cuenta la producción: de esta columna EN ADELANTE (hoy Realizado
  // y Entregado). El orden lo manda el tablero (window.Proceso.COLUMNAS), así
  // que una columna nueva después de «Entregado» entra sola en la cuenta.
  var COLUMNA_DESDE = 'realizado';
  var COLUMNAS_POR_DEFECTO = ['realizado', 'entregado'];

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var SIN_FECHA = '';           // la clave del cajón «Sin fecha» (y su etiqueta)
  var SIN_COLOR = 'Sin color';  // una pieza sin color anotado: se cuenta igual
  var SIN_PIEZA = { nombre: '', hex: '' };

  // Lo que se cuenta, en el orden en que se muestra. `tipo` y `pieza` son los
  // rótulos con los que viaja en el desglose de la cotización («Clicker de
  // Nombre» y «Base»): la pantalla los usa para el chip de cada tarjeta.
  var ELEMENTOS = [
    {
      id: 'clicer-base', tipo: 'Clicker de Nombre', pieza: 'Base',
      etiqueta: 'Bases del clicker',
      nota: 'Una por letra del nombre, con su color y su acabado.'
    },
    {
      id: 'clicer-tecla', tipo: 'Clicker de Nombre', pieza: 'Tecla',
      etiqueta: 'Teclas del clicker',
      nota: 'Una por letra del nombre, con el color de la tecla.'
    },
    {
      id: 'clicer-letra', tipo: 'Clicker de Nombre', pieza: 'Letra',
      etiqueta: 'Letras del clicker',
      nota: 'Una por letra del nombre, con el color de la letra impresa.'
    },
    {
      id: 'llavero-base', tipo: 'Llavero de Nombre', pieza: 'Base',
      etiqueta: 'Bases del llavero',
      nota: 'El cuerpo del llavero: uno por unidad.'
    },
    {
      id: 'llavero-nombre', tipo: 'Llavero de Nombre', pieza: 'Nombre',
      etiqueta: 'Nombres del llavero',
      nota: 'La pieza impresa: uno por unidad.'
    },
    {
      id: 'charm-base', tipo: 'Charm para Silla', pieza: 'Base',
      etiqueta: 'Bases del charm',
      nota: 'Una por letra, número o símbolo del texto, con el color de la base.'
    },
    {
      id: 'charm-tapa', tipo: 'Charm para Silla', pieza: 'Tapa',
      etiqueta: 'Tapas del charm',
      nota: 'Una por letra, número o símbolo del texto, con el color de la tapa.'
    },
    {
      id: 'manual-colores', tipo: 'Cotización manual', pieza: 'Color usado',
      etiqueta: 'Colores usados en cotizaciones manuales',
      nota: 'Los colores que se anotaron en cada cotización manual. Es una cuenta aparte: no suma a los colores de los demás productos.'
    }
  ];

  /* ----------------------------- Ayudas ----------------------------- */

  // Las columnas que se cuentan como producidas: de COLUMNA_DESDE en adelante.
  // Si window.Proceso no estuviera (una página de prueba, un frontend viejo en
  // caché), quedan las dos de siempre.
  function columnasContadas() {
    var columnas = window.Proceso && window.Proceso.COLUMNAS;
    if (!Array.isArray(columnas) || !columnas.length) return COLUMNAS_POR_DEFECTO.slice();
    var desde = -1;
    for (var i = 0; i < columnas.length; i++) {
      if ((columnas[i] || {}).id === COLUMNA_DESDE) { desde = i; break; }
    }
    if (desde < 0) return COLUMNAS_POR_DEFECTO.slice();
    return columnas.slice(desde).map(function (c) { return c.id; });
  }

  // '2026-10-13' (o '2026-10-13T10:00:00Z') -> '2026-10'. Sin fecha usable, ''.
  function mesDe(fecha) {
    var m = /^(\d{4})-(\d{2})/.exec(Utils.normalize(fecha));
    return m ? m[1] + '-' + m[2] : SIN_FECHA;
  }

  // '2026-10' -> 'octubre 2026' · '' -> 'Sin fecha'
  function etiquetaMes(mes) {
    var m = /^(\d{4})-(\d{2})$/.exec(mes || '');
    var indice = m ? Number(m[2]) - 1 : -1;
    if (indice < 0 || indice > 11) return 'Sin fecha';
    return MESES[indice] + ' ' + m[1];
  }

  // '2026-09' vs '2026-10': cronológico y por texto (el formato lo permite). El
  // cajón «Sin fecha» va al final, que es donde se lo busca.
  function compararMeses(a, b) {
    if (a === b) return 0;
    if (a === SIN_FECHA) return 1;
    if (b === SIN_FECHA) return -1;
    return a < b ? -1 : 1;
  }

  var redondear = function (n) { return Math.round(n * 100) / 100; };

  // Una pieza a partir de un detalle de la cotización: la cuenta sólo necesita
  // el color, porque la pieza ya se sabe por la posición (base, tecla, letra…).
  function piezaDe(detalle) {
    detalle = detalle || {};
    return {
      nombre: Utils.normalize(detalle.nombre),
      hex: Utils.normalize(detalle.hex)
    };
  }

  // Anota una pieza en el cajón de colores. La clave es «hex|nombre», igual que
  // en la PO: dos colores con el mismo hex pero distinto nombre (o al revés) no
  // se mezclan.
  function contarColor(donde, pieza, cantidad) {
    var nombre = Utils.normalize(pieza && pieza.nombre) || SIN_COLOR;
    var hex = Utils.normalize(pieza && pieza.hex);
    var clave = hex + '|' + nombre;
    var fila = donde[clave];
    if (!fila) {
      fila = { nombre: nombre, hex: hex, cantidad: 0 };
      donde[clave] = fila;
    }
    fila.cantidad += cantidad;
  }

  // El ranking de un cajón de colores: del más usado al menos y, a igualdad, por
  // nombre (así el orden no baila entre dos repintados). `parte` es la porción
  // que le toca dentro de esa cuenta: es lo que dibuja la barrita.
  function ranking(cajon, total) {
    var filas = Object.keys(cajon).map(function (clave) { return cajon[clave]; });
    filas.sort(function (a, b) {
      if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
      return a.nombre < b.nombre ? -1 : (a.nombre > b.nombre ? 1 : 0);
    });
    filas.forEach(function (fila, indice) {
      fila.puesto = indice + 1;
      fila.parte = total > 0 ? fila.cantidad / total : 0;
    });
    return filas;
  }

  // Las piezas de una tarjeta: lo que dice la tarjeta (`unidades`) y, si no
  // viniera, la suma de sus líneas. Es el «cantidad total» que muestra la
  // pantalla, tanto en producción como en ventas.
  function unidadesDe(tarjeta, items) {
    var anotadas = Number(Utils.parseNumber(tarjeta.unidades, NaN));
    if (isFinite(anotadas) && anotadas > 0) return Math.floor(anotadas);
    return (items || []).reduce(function (suma, item) {
      return suma + (PO && PO.cantidadDe ? PO.cantidadDe(item && item.cantidad) : 0);
    }, 0);
  }

  /* ------------------------- La cuenta de todo ------------------------- */

  // Lee el tablero y devuelve el informe completo. Es una función pura: no
  // guarda nada, así que se puede llamar en cada repintado sin costo de estado.
  function leer(tarjetas) {
    var lista = Array.isArray(tarjetas) ? tarjetas : [];
    var columnas = columnasContadas();

    // Los meses salen de las tarjetas que caen en alguna de las cuentas, y
    // quedan en orden cronológico.
    var meses = [];
    function anotarMes(mes) { if (meses.indexOf(mes) < 0) meses.push(mes); }

    // Cada elemento arranca en cero: la pantalla siempre muestra las cinco
    // tarjetas —aunque todavía no haya ni un llavero— y el informe no cambia de
    // forma según los datos.
    var elementos = ELEMENTOS.map(function (def) {
      return {
        id: def.id, tipo: def.tipo, pieza: def.pieza,
        etiqueta: def.etiqueta, nota: def.nota,
        total: 0, colores: {}, cajones: {}
      };
    });
    var porId = {};
    elementos.forEach(function (el) { porId[el.id] = el; });

    // Suma `cantidad` piezas de un elemento: al total general y al de su mes.
    function sumar(id, pieza, cantidad, mes) {
      var el = porId[id];
      if (!el || cantidad <= 0) return;
      el.total += cantidad;
      var cajon = el.cajones[mes] || (el.cajones[mes] = { cantidad: 0, colores: {} });
      cajon.cantidad += cantidad;
      contarColor(cajon.colores, pieza, cantidad);
      contarColor(el.colores, pieza, cantidad);
    }

    var cuenta = { tarjetas: 0, unidades: 0, sinReceta: 0 };
    var ventas = { total: 0, unidades: 0, tarjetas: 0, cajones: {} };

    lista.forEach(function (tarjeta) {
      tarjeta = tarjeta || {};
      var mes = mesDe(tarjeta.fecha);
      var items = Array.isArray(tarjeta.items) ? tarjeta.items : [];

      /* --- Ventas: cualquier tarjeta con «Pagado» tildado, en la columna que
         esté. El tilde es el que dice que se cobró. --- */
      if (tarjeta.pagado) {
        var plata = redondear(Number(Utils.parseNumber(tarjeta.total, 0)) || 0);
        var vendidas = unidadesDe(tarjeta, items);
        ventas.total = redondear(ventas.total + plata);
        ventas.unidades += vendidas;
        ventas.tarjetas += 1;
        var caja = ventas.cajones[mes] ||
          (ventas.cajones[mes] = { total: 0, unidades: 0, tarjetas: 0 });
        caja.total = redondear(caja.total + plata);
        caja.unidades += vendidas;
        caja.tarjetas += 1;
        anotarMes(mes);
      }

      /* --- Producción: sólo lo que ya se fabricó (de «Realizado» en
         adelante). En «Cotización» y en «Trabajo» no se cuenta nada. --- */
      if (columnas.indexOf(Utils.normalize(tarjeta.columna)) < 0) return;
      anotarMes(mes);
      cuenta.tarjetas += 1;
      cuenta.unidades += unidadesDe(tarjeta, items);

      items.forEach(function (item) {
        item = item || {};
        var cantidad = PO.cantidadDe(item.cantidad);
        var tipo = Utils.normalize(item.tipo);
        var detalles = Array.isArray(item.detalles) ? item.detalles : [];

        if (tipo === PO.TIPO_CLICER) {
          var letras = PO.piezasDeClicer(detalles);
          if (!letras.length) {
            // Clicker viejo (desglose «Base» + «Nombre»): no dice cuáles eran
            // las teclas ni las letras. Se informa y no se cuenta.
            cuenta.sinReceta += 1;
            return;
          }
          // Una base, una tecla y una letra por letra del nombre. Una letra
          // repetida («ANA») cuenta dos veces, y está bien: son dos piezas.
          letras.forEach(function (letra) {
            sumar('clicer-base', letra.base, cantidad, mes);
            sumar('clicer-tecla', letra.tecla, cantidad, mes);
            sumar('clicer-letra', letra.letra, cantidad, mes);
          });
          return;
        }

        if (tipo === PO.TIPO_LLAVERO) {
          var piezas = detalles.map(piezaDe);
          // Sin desglose no hay color que anotar, pero el cuerpo y el nombre
          // impreso salieron igual: se cuentan como «Sin color».
          var nombres = piezas.slice(1);
          sumar('llavero-base', piezas[0] || SIN_PIEZA, cantidad, mes);
          (nombres.length ? nombres : [SIN_PIEZA]).forEach(function (pieza) {
            sumar('llavero-nombre', pieza, cantidad, mes);
          });
          return;
        }
        if (tipo === PO.TIPO_CHARM) {
          // Una base y una tapa por cada pieza del texto («A · Base», «A · Tapa»). Los
          // charms sueltos no llevan color y no entran en la cuenta.
          detalles.forEach(function (d) {
            var rotulo = Utils.normalize(d && d.label);
            if (/ \u00b7 Base$/.test(rotulo)) sumar('charm-base', piezaDe(d), cantidad, mes);
            else if (/ \u00b7 Tapa$/.test(rotulo)) sumar('charm-tapa', piezaDe(d), cantidad, mes);
          });
          return;
        }

        if (tipo === PO.TIPO_MANUAL) {
          // Los colores usados que se anotaron a mano, por las unidades de la línea.
          // Van a su propia cuenta: no tocan los rankings de los demás productos.
          PO.coloresUsados(item).forEach(function (color) {
            sumar('manual-colores', color, color.cantidad * cantidad, mes);
          });
          return;
        }
        // Otro producto: no entra en ninguna de las cuentas.
      });
    });

    return cerrar({ columnas: columnas, cuenta: cuenta, meses: meses,
      elementos: elementos, ventas: ventas });
  }

  // Arma la salida final: rankings de colores, meses en orden y mejor mes de
  // ventas. Se hace al final y no mientras se cuenta, para que `parte` salga
  // sobre el total definitivo.
  function cerrar(datos) {
    // Las claves de los meses sirven dos veces: para la lista del informe (con
    // su etiqueta linda) y para armar la columna de cada elemento.
    var claves = datos.meses.slice().sort(compararMeses);

    datos.elementos.forEach(function (el) {
      var cajones = el.cajones;
      el.colores = ranking(el.colores, el.total);
      // Todos los meses del informe, con su cero incluido: la pieza que quedó
      // en 0 también dice algo (ese mes no se fabricó).
      el.meses = claves.map(function (mes) {
        var cajon = cajones[mes] || { cantidad: 0, colores: {} };
        return {
          mes: mes,
          etiqueta: etiquetaMes(mes),
          cantidad: cajon.cantidad,
          colores: ranking(cajon.colores, cajon.cantidad)
        };
      });
      delete el.cajones;
    });

    datos.meses = claves.map(function (mes) {
      return { mes: mes, etiqueta: etiquetaMes(mes) };
    });

    var mesesVentas = Object.keys(datos.ventas.cajones).sort(compararMeses);
    var mejor = null;
    datos.ventas.meses = mesesVentas.map(function (mes) {
      var caja = datos.ventas.cajones[mes];
      var fila = {
        mes: mes, etiqueta: etiquetaMes(mes),
        total: caja.total, unidades: caja.unidades, tarjetas: caja.tarjetas
      };
      // El mejor mes: el que más plata dejó (a igualdad, el más antiguo).
      if (!mejor || fila.total > mejor.total) mejor = fila;
      return fila;
    });
    datos.ventas.mejor = mejor;
    delete datos.ventas.cajones;

    datos.vacia = datos.cuenta.tarjetas === 0;
    return datos;
  }

  /* ------------------------------ Exportado ------------------------------ */

  window.Estadisticas = {
    COLUMNA_DESDE: COLUMNA_DESDE,
    COLUMNAS_POR_DEFECTO: COLUMNAS_POR_DEFECTO,
    ELEMENTOS: ELEMENTOS,
    columnasContadas: columnasContadas,
    mesDe: mesDe,
    etiquetaMes: etiquetaMes,
    leer: leer
  };
})();
