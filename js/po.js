/* Orden de producción (PO): lo que hay que fabricar, ya agrupado.
 *
 * La cotización dice QUÉ se vendió (una línea por producto, con sus colores);
 * la orden de producción dice QUÉ HAY QUE HACER para cumplirla: cuántas piezas
 * salen de cada tipo y color, sumadas entre todas las líneas. Ese es el trabajo
 * de este archivo, y así se agrupa:
 *
 *   · Clicker de Nombre: cada letra del nombre lleva tres piezas (base, tecla y
 *     letra). Se separan en tandas de producción:
 *       - las BASES, por color y acabado (el mismo cuerpo, el mismo material);
 *       - las TECLAS CON SU LETRA, por el par ordenado tecla -> letra. El orden
 *         importa: una tecla roja con letra blanca NO es la misma tanda que una
 *         tecla blanca con letra roja, son dos producciones distintas (igual que
 *         con las bases: base blanca con letras negras no es base negra con
 *         letras blancas).
 *   · Llavero de Nombre: se agrupa por su combinación ordenada cuerpo -> nombre
 *     impreso. Los que comparten combinación se fabrican juntos, y los nombres
 *     salen listados adentro del grupo.
 *   · Cualquier otro producto: se agrupa por su combinación de colores tal como
 *     venga, así la PO nunca deja una línea afuera.
 *
 * Además arma los MATERIALES por color (cuántas piezas de cada color hay que
 * imprimir), que es lo que se mira para preparar los filamentos.
 *
 * Nada de esto toca los precios: la PO es de taller, la plata sigue estando en
 * la cotización. Vive aparte de las vistas para poder probarlo sin navegador
 * (ver __prueba-po.mjs). Se expone como window.PO. */
(function () {
  'use strict';

  var Utils = window.Utils;

  // Los mismos nombres que usan las líneas de la cotización y del tablero.
  var TIPO_CLICER = 'Clicker de Nombre';
  var TIPO_LLAVERO = 'Llavero de Nombre';
  var TIPO_MANUAL = 'Cotización manual';

  // Las piezas del clicker, tal como las nombra window.Clicer en los labels
  // («A · Base»): el label dice el carácter y la pieza, separados por ·.
  var PIEZA_BASE = 'Base';
  var PIEZA_TECLA = 'Tecla';
  var PIEZA_LETRA = 'Letra';

  var SEP = '\u00b7';   // el · que separa el carácter de la pieza

  /* ---------------------------- Piezas de una línea ---------------------------- */

  // Cantidad siempre es un entero >= 1 (0 o basura cuentan como una pieza).
  function cantidadDe(valor) {
    var n = Math.floor(Utils.parseNumber(valor, 1));
    return n > 0 ? n : 1;
  }

  // Último tramo del label: 'A · Base' -> 'Base' · 'Base' -> ''
  function sufijoDe(label) {
    var partes = String(label == null ? '' : label).split(SEP);
    return partes.length > 1 ? Utils.normalize(partes[partes.length - 1]) : '';
  }

  // Todo lo que va delante del último ·: 'A · Base' -> 'A' (el carácter).
  function caracterDe(label) {
    var partes = String(label == null ? '' : label).split(SEP);
    return partes.length > 1 ? Utils.normalize(partes.slice(0, -1).join(SEP)) : '';
  }

  // Una pieza con la forma en la que viaja en los detalles de la línea.
  function piezaDe(d) {
    d = d || {};
    return {
      label: d.label == null ? '' : String(d.label),
      nombre: d.nombre == null ? '' : String(d.nombre),
      hex: d.hex == null ? '' : String(d.hex)
    };
  }

  // Lo que identifica un color: el tono y cómo se llama en el stock.
  function colorClave(pieza) {
    return (pieza.hex || '') + '|' + (pieza.nombre || '');
  }

  // La combinación ORDENADA de una lista de piezas: es la identidad de un grupo
  // (base → nombre, o tecla → letra). Si el orden cambia, la clave cambia.
  function combinacionClave(piezas) {
    return (piezas || []).map(colorClave).join('~');
  }

  /* ------------------------- Las piezas del clicker -------------------------
     Los detalles de un clicker vienen de a TRES por letra, en orden: base, tecla
     y letra. Si el desglose no tiene esa forma (una cotización vieja, de cuando
     el clicker se armaba con «Base» y «Nombre»), no se inventa nada: esa línea
     se agrupa por su combinación de colores, como cualquier otro producto. */

  function detallesDeClicer(detalles) {
    if (!Array.isArray(detalles) || detalles.length < 3 || detalles.length % 3 !== 0) return false;
    var esperadas = [PIEZA_BASE, PIEZA_TECLA, PIEZA_LETRA];
    for (var i = 0; i < detalles.length; i++) {
      if (sufijoDe(detalles[i] && detalles[i].label) !== esperadas[i % 3]) return false;
    }
    return true;
  }

  // Una entrada por letra: { caracter, base, tecla, letra } (cada una, la pieza).
  function piezasDeClicer(detalles) {
    var lista = [];
    if (!detallesDeClicer(detalles)) return lista;
    for (var i = 0; i + 2 < detalles.length; i += 3) {
      lista.push({
        caracter: caracterDe(detalles[i].label),
        base: piezaDe(detalles[i]),
        tecla: piezaDe(detalles[i + 1]),
        letra: piezaDe(detalles[i + 2])
      });
    }
    return lista;
  }

  /* --------------------- Nombres que traen el acabado ---------------------
     El color de la base se pide al proveedor como «Negro (Corrugado)». Para
     agrupar hay que separar el color del acabado, y en la hoja se muestran
     aparte para que el taller sepa qué cuerpo va. */

  function sinParentesis(nombre) {
    return String(nombre == null ? '' : nombre).replace(/\s*\([^()]*\)\s*$/, '');
  }

  function entreParentesis(nombre) {
    var m = /\(([^()]*)\)\s*$/.exec(String(nombre == null ? '' : nombre));
    return m ? m[1] : '';
  }

  // El color y su acabado, cada uno por su lado: «Café (Corrugado)» ->
  // { color: 'Café', acabado: 'Corrugado' }. Es lo que piden las dos columnas
  // del ensamble (color de base y estilo de base), sin volver a parsear en la
  // vista. Una base sin acabado devuelve acabado ''.
  function colorYAcabado(nombre) {
    var texto = String(nombre == null ? '' : nombre);
    return { color: sinParentesis(texto), acabado: entreParentesis(texto) };
  }

  /* ------------------------------ Acumuladores ------------------------------ */

  // Busca el grupo de una clave (lo crea la primera vez) para ir sumándole.
  function grupo(indice, lista, clave, crear) {
    if (!indice[clave]) {
      indice[clave] = crear();
      lista.push(indice[clave]);
    }
    return indice[clave];
  }

  // Suma una vez el nombre de la línea (en el grupo, «de dónde sale»).
  function sumarTitulo(dueno, item, cantidad) {
    var titulo = Utils.normalize(item.titulo) || Utils.normalize(item.tipo);
    if (!titulo) return;
    for (var i = 0; i < dueno.titulos.length; i++) {
      if (dueno.titulos[i].nombre === titulo) {
        dueno.titulos[i].cantidad += cantidad;
        return;
      }
    }
    dueno.titulos.push({ nombre: titulo, cantidad: cantidad });
  }

  // Suma la forma de una letra (A, L, S…): sirve para saber cuántas «A» imprimir.
  function sumarForma(dueno, caracter, cantidad) {
    var letra = Utils.normalize(caracter);
    if (!letra) return;
    for (var i = 0; i < dueno.formas.length; i++) {
      if (dueno.formas[i].caracter === letra) {
        dueno.formas[i].cantidad += cantidad;
        return;
      }
    }
    dueno.formas.push({ caracter: letra, cantidad: cantidad });
  }

  // Cuántas piezas de cada color: es la lista para preparar el filamento.
  function sumarMaterial(indice, lista, producto, pieza, colores, unidades) {
    (colores || []).forEach(function (d) {
      var p = piezaDe(d);
      if (!p.nombre && !p.hex) return;
      var clave = producto + '~' + pieza + '~' + colorClave(p);
      grupo(indice, lista, clave, function () {
        return { producto: producto, pieza: pieza, nombre: p.nombre, hex: p.hex, cantidad: 0 };
      }).cantidad += unidades;
    });
  }

  /* ------------------------------- Agrupación -------------------------------
     Un solo recorrido por las líneas: cada pieza de cada unidad entra en su
     grupo. Multiplicar por la cantidad de la línea es lo que hace que «2×
     clicker ALLISON» dé 14 bases y no 7. */

  function leer(items) {
    var lista = Array.isArray(items) ? items : [];
    var grupos = { llaveros: [], bases: [], teclas: [], otros: [], materiales: [] };
    var indice = { llaveros: {}, bases: {}, teclas: {}, otros: {}, materiales: {} };
    var productos = [];
    var indiceProductos = {};
    var unidades = 0;

    function sumarProducto(tipo, cantidad) {
      var clave = Utils.normalize(tipo) || 'Producto';
      if (!indiceProductos[clave]) {
        indiceProductos[clave] = { tipo: clave, cantidad: 0, lineas: 0 };
        productos.push(indiceProductos[clave]);
      }
      indiceProductos[clave].cantidad += cantidad;
      indiceProductos[clave].lineas += 1;
    }

    lista.forEach(function (item) {
      item = item || {};
      var detalles = Array.isArray(item.detalles) ? item.detalles : [];
      var cantidad = cantidadDe(item.cantidad);
      var tipo = Utils.normalize(item.tipo);
      // Una línea sin tipo, sin nombre y sin detalles no es un producto: es
      // basura de un dato viejo. No se cuenta ni se inventa un grupo con ella.
      if (!tipo && !Utils.normalize(item.titulo) && !detalles.length) return;
      unidades += cantidad;
      sumarProducto(tipo, cantidad);

      // --- Clicker: una pieza de cada tipo por cada letra del nombre ---
      if (tipo === TIPO_CLICER && detallesDeClicer(detalles)) {
        piezasDeClicer(detalles).forEach(function (letra) {
          var b = grupo(indice.bases, grupos.bases, colorClave(letra.base), function () {
            return {
              cantidad: 0,
              nombre: sinParentesis(letra.base.nombre),
              acabado: entreParentesis(letra.base.nombre),
              hex: letra.base.hex,
              formas: [],
              titulos: []
            };
          });
          b.cantidad += cantidad;
          sumarForma(b, letra.caracter, cantidad);
          sumarTitulo(b, item, cantidad);

          // La tecla y su letra van juntas y en ese orden: la tanda es el par.
          var t = grupo(indice.teclas, grupos.teclas,
            colorClave(letra.tecla) + '~' + colorClave(letra.letra), function () {
              return { cantidad: 0, tecla: letra.tecla, letra: letra.letra, formas: [], titulos: [] };
            });
          t.cantidad += cantidad;
          sumarForma(t, letra.caracter, cantidad);
          sumarTitulo(t, item, cantidad);

          sumarMaterial(indice.materiales, grupos.materiales, TIPO_CLICER, PIEZA_BASE,
            [letra.base], cantidad);
          sumarMaterial(indice.materiales, grupos.materiales, TIPO_CLICER, PIEZA_TECLA,
            [letra.tecla], cantidad);
          sumarMaterial(indice.materiales, grupos.materiales, TIPO_CLICER, PIEZA_LETRA,
            [letra.letra], cantidad);
        });
        return;
      }

      // --- Llavero: el cuerpo y el nombre impreso, como una combinación ---
      if (tipo === TIPO_LLAVERO) {
        var piezas = detalles.map(piezaDe);
        if (!piezas.length) piezas = [{ label: '', nombre: item.titulo || '', hex: '' }];
        var gl = grupo(indice.llaveros, grupos.llaveros, combinacionClave(piezas), function () {
          return { cantidad: 0, piezas: piezas, titulos: [] };
        });
        gl.cantidad += cantidad;
        sumarTitulo(gl, item, cantidad);
        sumarMaterial(indice.materiales, grupos.materiales, TIPO_LLAVERO, 'Cuerpo',
          [piezas[0]], cantidad);
        sumarMaterial(indice.materiales, grupos.materiales, TIPO_LLAVERO, 'Nombre',
          piezas.slice(1), cantidad);
        return;
      }

      // --- Cualquier otro producto: por su combinación de colores ---
      // La cotización manual no tiene recetas de color: su desglose es texto
      // para el cliente, no piezas a fabricar.
      var suyas = tipo === TIPO_MANUAL ? [] : detalles.map(piezaDe);
      var go = grupo(indice.otros, grupos.otros, tipo + '~' + combinacionClave(suyas),
        function () {
          return {
            cantidad: 0,
            tipo: tipo || 'Producto',
            piezas: suyas,
            piezasPorUnidad: suyas.length,
            titulos: []
          };
        });
      go.cantidad += cantidad;
      sumarTitulo(go, item, cantidad);
      suyas.forEach(function (p) {
        sumarMaterial(indice.materiales, grupos.materiales, go.tipo, p.label || 'Pieza', [p],
          cantidad);
      });
    });

    return cerrar(grupos, productos, lista.length, unidades);
  }

  /* ------------------------------- Resultado -------------------------------
     Ordena los grupos (los más grandes primero) y saca los totales que van en
     la hoja y en el resumen de la tarjeta. */

  function ordenar(lista, textoDe) {
    return lista.slice().sort(function (a, b) {
      if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
      var ta = textoDe(a);
      var tb = textoDe(b);
      return ta < tb ? -1 : (ta > tb ? 1 : 0);
    });
  }

  // El texto de un grupo (para desempatar por nombre cuando hay misma cantidad).
  function textoBase(g) { return g.nombre + ' ' + g.acabado; }
  function textoTecla(g) { return g.tecla.nombre + ' ' + g.letra.nombre; }
  function textoTitulos(g) {
    return g.titulos.map(function (t) { return t.nombre; }).join(' ');
  }

  function cerrar(grupos, productos, lineas, unidades) {
    var bases = 0, teclas = 0, llaveros = 0, otros = 0, otrosPiezas = 0;

    grupos.bases.forEach(function (g) {
      bases += g.cantidad;
      g.formas = ordenar(g.formas, function (f) { return f.caracter; });
      g.titulos = ordenar(g.titulos, function (t) { return t.nombre; });
    });
    grupos.teclas.forEach(function (g) {
      teclas += g.cantidad;
      g.formas = ordenar(g.formas, function (f) { return f.caracter; });
      g.titulos = ordenar(g.titulos, function (t) { return t.nombre; });
    });
    grupos.llaveros.forEach(function (g) {
      llaveros += g.cantidad;
      g.titulos = ordenar(g.titulos, function (t) { return t.nombre; });
    });
    grupos.otros.forEach(function (g) {
      otros += g.cantidad;
      otrosPiezas += g.cantidad * Math.max(1, g.piezasPorUnidad);
      g.titulos = ordenar(g.titulos, function (t) { return t.nombre; });
    });

    grupos.bases = ordenar(grupos.bases, textoBase);
    grupos.teclas = ordenar(grupos.teclas, textoTecla);
    grupos.llaveros = ordenar(grupos.llaveros, textoTitulos);
    grupos.otros = ordenar(grupos.otros, function (g) { return g.tipo; });
    grupos.materiales = grupos.materiales.slice().sort(function (a, b) {
      if (a.producto !== b.producto) return a.producto < b.producto ? -1 : 1;
      if (a.pieza !== b.pieza) return a.pieza < b.pieza ? -1 : 1;
      if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
      return a.nombre < b.nombre ? -1 : (a.nombre > b.nombre ? 1 : 0);
    });
    productos.sort(function (a, b) {
      if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
      return a.tipo < b.tipo ? -1 : 1;
    });

    // Cada tecla lleva su letra, así que las dos cuentas son la misma: se dejan
    // las dos porque en la hoja se nombran juntas («teclas con su letra»).
    var totales = {
      lineas: lineas,
      unidades: unidades,
      productos: productos,
      grupos: grupos.llaveros.length + grupos.bases.length + grupos.teclas.length +
        grupos.otros.length,
      llaveros: llaveros,
      bases: bases,
      teclas: teclas,
      letras: teclas,
      otros: otros,
      // Piezas a imprimir: cada llavero son dos (cuerpo + nombre), cada tecla son
      // dos (tecla + letra) y cada base del clicker una sola.
      piezas: llaveros * 2 + bases + teclas * 2 + otrosPiezas
    };

    return {
      llaveros: grupos.llaveros,
      bases: grupos.bases,
      teclas: grupos.teclas,
      otros: grupos.otros,
      materiales: grupos.materiales,
      totales: totales,
      vacia: unidades === 0
    };
  }

  // Los totales solos: es lo que necesita la tarjeta para su resumen.
  function resumen(items) {
    return leer(items).totales;
  }

  /* ------------------------------- Ensamble -------------------------------
     La receta de armado de cada clicker: letra por letra, y en el orden del
     nombre, qué base lleva (con el color y el acabado por separado), qué tecla
     y de qué color va la letra impresa. Es lo que se mira en la mesa al armar;
     cuántas piezas de cada color imprimir ya lo dice la PO (leer), así que acá
     no se suma nada: la receta es de UNA unidad (un clicker) y la cantidad de
     clickers va aparte, en `cantidad`.
     Un clicker viejo —de cuando el desglose no venía de a tres piezas por
     letra— no tiene receta: no se inventan filas, esa línea queda afuera (en la
     PO cae en «Otros productos»). */

  // Una letra suelta: sirve para distinguir una tecla del símbolo escrito a
  // mano, que se fabrica tal como se lee («estrella», «corazón»).
  var LETRA_SUELTA = /^[A-ZÁÉÍÓÚÜÑ]$/;

  function ensamble(items) {
    var lista = Array.isArray(items) ? items : [];
    var clickers = [];

    lista.forEach(function (item) {
      item = item || {};
      if (Utils.normalize(item.tipo) !== TIPO_CLICER) return;

      var letras = piezasDeClicer(item.detalles).map(function (l) {
        var base = colorYAcabado(l.base.nombre);
        var caracter = Utils.normalize(l.caracter);
        return {
          caracter: caracter,
          simbolo: !LETRA_SUELTA.test(caracter.toUpperCase()),
          base: { nombre: base.color, hex: l.base.hex },
          acabado: base.acabado,
          tecla: { nombre: Utils.normalize(l.tecla.nombre), hex: l.tecla.hex },
          letra: { nombre: Utils.normalize(l.letra.nombre), hex: l.letra.hex }
        };
      });

      if (!letras.length) return;
      clickers.push({
        id: item.id || '',
        nombre: Utils.normalize(item.titulo) || TIPO_CLICER,
        cantidad: cantidadDe(item.cantidad),
        letras: letras
      });
    });

    return clickers;
  }

  window.PO = {
    TIPO_CLICER: TIPO_CLICER,
    TIPO_MANUAL: TIPO_MANUAL,
    TIPO_LLAVERO: TIPO_LLAVERO,
    PIEZAS: { base: PIEZA_BASE, tecla: PIEZA_TECLA, letra: PIEZA_LETRA },
    cantidadDe: cantidadDe,
    sufijoDe: sufijoDe,
    caracterDe: caracterDe,
    combinacionClave: combinacionClave,
    detallesDeClicer: detallesDeClicer,
    piezasDeClicer: piezasDeClicer,
    colorYAcabado: colorYAcabado,
    ensamble: ensamble,
    leer: leer,
    resumen: resumen
  };
})();
