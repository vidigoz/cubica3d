/* Vista de Proceso: tablero Kanban de las cotizaciones enviadas.
 * Ruta: #/proceso. Se expone como window.Views.proceso
 *
 * Las tarjetas cambian de columna (Cotización -> Trabajo -> Realizado ->
 * Entregado) con los botones de la propia tarjeta: «← Atrás» y «Adelante →», que
 * además llevan el nombre de la columna a la que van. Y se acomodan arrastrando:
 * con el mouse se agarra al mover un poco, y con el dedo después de mantener
 * pulsado —así el gesto no pelea con el scroll de la página, que fue lo que hizo
 * descartar el arrastre antes— (ver la sección «Arrastrar y soltar»).
 * Lo que llega a una columna por un cambio de columna entra ABAJO; la cotización
 * nueva desde el carrito entra arriba de «Cotización», que es la que hay que ver.
 * Cada tarjeta trae el tilde de «Pagado» al lado del importe: se tilda solo al
 * entrar a «Entregado» (lo hace el servidor) y se puede destildar a mano.
 * El nombre del cliente se corrige desde la propia tarjeta: se toca el nombre y se
 * escribe (Enter o salir del campo guarda, Esc cancela); así se arregla un dedazo
 * del carrito sin borrar y volver a enviar la cotización.
 * En el «Detalle para fabricar» las dos secciones que el taller imprime de a tandas
 * —las bases del clicker y las teclas con su letra— llevan su tilde: se marca lo que
 * ya está hecho (Proceso.cambiarListas) para no repetir una tanda ni dejar pasar la
 * que falta. El tilde es del tablero: no sale en la hoja ni en el PDF.
 * La cotización completa se ve con el botón «Ver» (PDF.ver) y se descarga con 🖨. */
(function () {
  'use strict';

  var Utils = window.Utils;
  var Proceso = window.Proceso;
  var PDF = window.PDF;
  var PO = window.PO;

  var rootEl = null;
  var boundEl = null;   // el contenedor de la app es siempre el mismo: se engancha una vez
  var abiertas = {};    // tarjetas con el detalle desplegado (sobrevive al repintado)
  // La columna que se ve en pantallas angostas (celular): ahí el tablero muestra una
  // columna a la vez, con pestañas arriba, en vez de apilar las cuatro. En pantallas
  // grandes se ven todas y esto no hace nada (ver .kanban__tabs en el CSS).
  var columnaActiva = 'cotizacion';

  // Desde qué columna se ofrece «Ensamble»: la receta de armado se consulta
  // cuando la venta ya salió al taller, así que está desde «Trabajo» en adelante
  // (en «Cotización» todavía se está cotizando). Se guarda por NOMBRE y se compara
  // por ÍNDICE, así una columna nueva al final lo hereda sola.
  var ENSAMBLE_DESDE = 'trabajo';

  /* ---------------------------- Plantillas ---------------------------- */

  function headTemplate() {
    return '' +
      '<div class="page__head">' +
        '<h2 class="page__title">Proceso</h2>' +
        '<p class="page__subtitle">Cada tarjeta es una cotización enviada. Para pasarla a la ' +
          'columna siguiente pulsa <b>Adelante &rarr;</b>, y para devolverla <b>&larr; Atrás</b>: ' +
          'los botones de la tarjeta dicen a qué columna va cada uno. Para acomodarla, ' +
          '<b>arrástrala</b> con el mouse &mdash;o mant&eacute;nla pulsada con el dedo&mdash; y ' +
          'suelta donde quieras: lo que llega a una columna entra <b>abajo</b>, así los ' +
          'trabajos viejos quedan arriba y los nuevos abajo.</p>' +
      '</div>';
  }

  // '2026-10-09T18:20:00.000Z' -> '09/10/2026 18:20'
  function fechaHora(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  // Importe de una línea de la tarjeta (precio unitario × cantidad).
  function importeLinea(item) {
    var cantidad = Math.floor(Utils.parseNumber(item.cantidad, 1));
    if (!(cantidad > 0)) cantidad = 1;
    return Utils.parseNumber(item.precio, 0) * cantidad;
  }

  // "2× Llavero de Nombre · 3× Clicker de Nombre"
  function resumenProductos(items) {
    return items.map(function (item) {
      return item.cantidad + '\u00d7 ' + item.tipo;
    }).join(' \u00b7 ');
  }

  // Los nombres a fabricar, uno por línea y sin colores: «1× Allison». Los
  // colores son cosa del taller y aparecen más abajo, en los lotes, recién
  // cuando la cotización salió de «Cotización» y hay una orden de producción
  // (ver lotesTemplate). El detalle con todos los colores sigue estando en el
  // botón «Ver» y en el PDF.
  function lineasTemplate(items) {
    return items.map(function (item) {
      return '' +
        '<li class="t-linea">' +
          '<span class="t-linea__cant">' + item.cantidad + '\u00d7</span>' +
          '<span class="t-linea__info">' +
            '<span class="t-linea__nombre">' +
              Utils.escapeHtml(item.titulo || item.tipo) + '</span>' +
            (item.titulo
              ? '<span class="t-linea__tipo">' + Utils.escapeHtml(item.tipo) + '</span>'
              : '') +
          '</span>' +
          '<span class="t-linea__precio">' + Utils.formatMoney(importeLinea(item)) + '</span>' +
        '</li>';
    }).join('');
  }

  // Abre la edición de una tarjeta. El borrador del carrito (si hay uno) se hace a
  // un lado y vuelve solo al guardar o cancelar. Una tarjeta ya pagada o en
  // producción pide confirmación: lo que cambie puede afectar lo que se fabrica.
  function editarCotizacion(id) {
    var t = Proceso.getTarjeta(id);
    if (!t) return;
    var folio = PDF.folioTexto(t.folio);

    var enCurso = Cart.getEdicion();
    if (enCurso && enCurso.id !== t.id) {
      window.App.toast('Termina o cancela primero la edici\u00f3n de ' + PDF.folioTexto(enCurso.folio), 'error');
      return;
    }

    if (!enCurso) {
      var avisos = [];
      if (t.columna !== Proceso.COLUMNAS[0].id) avisos.push('ya est\u00e1 en \u00ab' + Proceso.getColumna(t.columna).nombre + '\u00bb');
      if (t.pagado) avisos.push('ya est\u00e1 pagada');
      if (avisos.length && !window.confirm('La cotizaci\u00f3n ' + folio + ' ' + avisos.join(' y ') +
          '. Si cambias lo que se fabrica, se destildan las bases y teclas ya hechas. \u00bfEditarla?')) return;

      var habiaBorrador = Cart.getCount() > 0;
      Cart.empezarEdicion(t);
      if (habiaBorrador) window.App.toast('Tu carrito en armado queda guardado y vuelve al terminar');
    }
    window.App.navigate('productos');
  }

  /* ------------------ Lo que hay que fabricar, en corto ------------------
     Las mismas tandas de la orden de producción (las cuentas las hace
     window.PO), pero dentro de la tarjeta: para saber qué imprimir sin abrir
     la hoja. Van en el idioma del taller —cantidad, colores y qué letras
     lleva cada tanda— y con la misma agrupación que la PO: las bases por color
     y acabado, y las teclas con su letra y en ese orden. */

  // «● Café» con su nombre: el color como se pide al proveedor.
  function colorTexto(etiqueta, nombre, hex) {
    return '<span class="meta-tag">' + (etiqueta ? Utils.escapeHtml(etiqueta) + ' ' : '') +
      Utils.marcaDetalle({ label: etiqueta, nombre: nombre, hex: hex }, 'dot') +
      Utils.escapeHtml(nombre) + '</span>';
  }

  function coloresTexto(piezas) {
    return (piezas || []).map(function (p) {
      return colorTexto(p.label, p.nombre, p.hex);
    }).join('');
  }

  // «Luis ×2, Ana»: de qué líneas de la cotización sale la tanda.
  function titulosTexto(titulos) {
    return (titulos || []).map(function (t) {
      return Utils.escapeHtml(t.nombre) + (t.cantidad > 1 ? ' \u00d7' + t.cantidad : '');
    }).join(', ');
  }

  // «A ×2 · L · I» — las letras que entran en la tanda.
  function formasTexto(formas) {
    return (formas || []).map(function (f) {
      return Utils.escapeHtml(f.caracter) + (f.cantidad > 1 ? ' \u00d7' + f.cantidad : '');
    }).join(' \u00b7 ');
  }

  // Una tanda: cantidad, lo que se imprime y qué letras lleva.
  function loteTemplate(cantidad, piezas, lleva) {
    return '' +
      '<li class="t-lote">' +
        '<span class="t-lote__cant">' + cantidad + '</span>' +
        '<span class="t-lote__piezas">' + piezas + '</span>' +
        (lleva ? '<span class="t-lote__lleva">' + lleva + '</span>' : '') +
      '</li>';
  }

  // El rótulo de una sección del desglose. Las que el taller fabrica de a tandas
  // —las bases del clicker y las teclas con su letra— llevan su tilde delante y el
  // rótulo entero es la casilla (se puede tocar, que en el móvil hace falta); las
  // demás (llaveros, otros productos) son un rótulo sin nada que tildar.
  // `listas` llega como { tanda, listo, pista } o sin venir, y el texto de `titulo`
  // ya trae el conteo de piezas.
  function loteSecTemplate(titulo, listas) {
    var rotulo = '<span class="t-lotes__titulo">' + Utils.escapeHtml(titulo) + '</span>';
    if (!listas) return '<p class="t-lotes__sec">' + rotulo + '</p>';

    return '' +
      '<label class="t-lotes__sec' + (listas.listo ? ' t-lotes__sec--listo' : '') + '"' +
        ' title="' + Utils.escapeHtml(listas.pista) + '">' +
        '<input type="checkbox" data-listas="' + Utils.escapeHtml(listas.tanda) + '"' +
          (listas.listo ? ' checked' : '') + '>' +
        rotulo +
      '</label>';
  }

  function loteGrupoTemplate(titulo, filas, nota, listas) {
    if (!filas.length) return '';
    return '' +
      loteSecTemplate(titulo, listas) +
      (nota ? '<p class="t-lotes__nota">' + Utils.escapeHtml(nota) + '</p>' : '') +
      '<ul class="t-lote-lista' + (listas && listas.listo ? ' t-lote-lista--listo' : '') + '">' +
        filas.join('') +
      '</ul>';
  }

  // Los tildes de una tarjeta: qué tandas del taller ya están hechas. Es lo que
  // guarda Proceso (`basesListas` y `teclasListas`, por tarjeta) y acá sólo se pinta.
  // Se arman de una vez los dos para que `lotesTemplate` los pase tal cual.
  function listasDe(t) {
    return {
      bases: {
        tanda: 'bases',
        listo: !!(t && t.basesListas),
        pista: 'Las bases del clicker ya est\u00e1n hechas'
      },
      teclas: {
        tanda: 'teclas',
        listo: !!(t && t.teclasListas),
        pista: 'Las teclas con su letra ya est\u00e1n hechas'
      }
    };
  }

  // El desglose del taller: las secciones de la PO que tengan algo (bases del
  // clicker, teclas con su letra, llaveros y otros productos) y, al final, el
  // resumen de piezas. Sin nada que fabricar (o en la primera columna, ver
  // poDe) no se pinta nada. La tarjeta (`t`) trae los tildes de lo ya hecho.
  function lotesTemplate(po, t) {
    if (!po) return '';

    var listas = listasDe(t);
    var bases = po.bases.map(function (g) {
      return loteTemplate(g.cantidad,
        colorTexto('', g.nombre, g.hex) +
          (g.acabado ? '<span class="po-acabado">' + Utils.escapeHtml(g.acabado) + '</span>' : ''),
        formasTexto(g.formas));
    });
    var teclas = po.teclas.map(function (g) {
      return loteTemplate(g.cantidad,
        colorTexto('Tecla', g.tecla.nombre, g.tecla.hex) +
          colorTexto('Letra', g.letra.nombre, g.letra.hex),
        formasTexto(g.formas));
    });
    var llaveros = po.llaveros.map(function (g) {
      return loteTemplate(g.cantidad, coloresTexto(g.piezas), titulosTexto(g.titulos));
    });
    var otros = po.otros.map(function (g) {
      return loteTemplate(g.cantidad,
        '<b>' + Utils.escapeHtml(g.tipo) + '</b> ' + coloresTexto(g.piezas),
        titulosTexto(g.titulos));
    });

    var secciones =
      loteGrupoTemplate('Bases del clicker (' + po.totales.bases + ')', bases,
        'Todas las del mismo color y acabado se imprimen juntas.', listas.bases) +
      loteGrupoTemplate('Teclas con su letra (' + po.totales.teclas + ')', teclas,
        'La tecla y la letra de arriba van juntas, en ese orden.', listas.teclas) +
      loteGrupoTemplate('Llaveros (' + po.totales.llaveros + ')', llaveros) +
      loteGrupoTemplate('Otros productos (' + po.totales.otros + ')', otros);
    if (!secciones) return '';

    return '' +
      '<div class="t-lotes">' +
        secciones +
        '<p class="t-lotes__total">' + Utils.escapeHtml(poResumenTexto(po.totales)) +
          ' \u00b7 ' + po.totales.piezas + ' piezas</p>' +
      '</div>';
  }

  // Botón que mueve la tarjeta una columna: paso -1 (atrás) o +1 (adelante).
  // Lleva el nombre de la columna destino («← Cotización», «Trabajo →»), así en
  // el móvil se ve a dónde va sin adivinar, y se apaga cuando no hay a dónde ir.
  function moverBotonTemplate(indice, paso) {
    var destino = Proceso.COLUMNAS[indice + paso];
    var siguiente = paso > 0;
    var nombre = destino ? destino.nombre : (siguiente ? 'Adelante' : 'Atr\u00e1s');
    var rotulo = siguiente ? nombre + ' \u2192' : '\u2190 ' + nombre;
    var pista = destino
      ? 'Mover a ' + destino.nombre
      : 'Ya est\u00e1 en la ' + (siguiente ? '\u00faltima' : 'primera') + ' columna';

    return '<button class="btn-mover" type="button" data-mover="' +
        (siguiente ? 'siguiente' : 'anterior') + '" title="' + Utils.escapeHtml(pista) + '"' +
        (destino ? '' : ' disabled') + '>' +
        '<span class="btn-mover__texto">' + Utils.escapeHtml(rotulo) + '</span>' +
      '</button>';
  }

  // La orden de producción de una tarjeta, ya agrupada por window.PO. Sólo se
  // arma cuando la cotización salió de la columna «Cotización»: mientras está
  // ahí todavía se está cotizando y no hay nada que fabricar.
  function poDe(t) {
    if (!PO || t.columna === Proceso.COLUMNAS[0].id) return null;
    var po = PO.leer(t.items);
    return po.vacia ? null : po;
  }

  // Las recetas de armado de la tarjeta, si le toca el ensamble: desde «Trabajo»
  // en adelante (ver ENSAMBLE_DESDE) y sólo cuando trae clickers con receta. Una
  // tarjeta de sólo llaveros no ofrece el botón: no hay letras que armar.
  function recetasDe(t) {
    if (!PO || !PO.ensamble) return [];
    if (Proceso.indiceColumna(t.columna) < Proceso.indiceColumna(ENSAMBLE_DESDE)) return [];
    return PO.ensamble(t.items);
  }

  // «7 bases · 7 teclas + 7 letras · 3 llaveros · 4 grupos»: lo que hay que
  // fabricar, en corto, para verlo en la tarjeta sin abrir la hoja.
  function poResumenTexto(totales) {
    function plural(n, singular, plural_) {
      return n + ' ' + (n === 1 ? singular : plural_);
    }
    var partes = [];
    if (totales.bases) partes.push(plural(totales.bases, 'base', 'bases'));
    if (totales.teclas) {
      partes.push(plural(totales.teclas, 'tecla', 'teclas') + ' + ' +
        plural(totales.letras, 'letra', 'letras'));
    }
    if (totales.llaveros) partes.push(plural(totales.llaveros, 'llavero', 'llaveros'));
    if (totales.otros) partes.push(plural(totales.otros, 'otro producto', 'otros productos'));
    partes.push(plural(totales.grupos, 'grupo', 'grupos'));
    return partes.join(' \u00b7 ');
  }

  // El tilde del pago, pegado al importe. Se puede cambiar en cualquier columna
  // (a veces se cobra por adelantado y a veces se entrega y se cobra después); al
  // pasar la tarjeta a «Entregado» llega tildado solo. Lo guarda Proceso.
  function pagadoTemplate(t) {
    return '' +
      '<label class="tarjeta__pagado">' +
        '<input type="checkbox" data-pagado' + (t.pagado ? ' checked' : '') +
          ' title="Marcar la cotización como pagada">' +
        '<span>Pagado</span>' +
      '</label>';
  }

  // El nombre del cliente, que se puede corregir ahí mismo: es un botón sin caja
  // (se ve como el texto) y al pulsarlo se vuelve un campo (ver editarCliente).
  // Dejarlo vacío guarda «sin nombre», como las tarjetas que se envían así.
  function clienteTemplate(t) {
    return '' +
      '<button class="tarjeta__cliente-btn" type="button" data-cliente ' +
        'title="Corregir el nombre del cliente">' +
        (t.cliente
          ? Utils.escapeHtml(t.cliente)
          : '<span class="tarjeta__sin-cliente">Sin cliente</span>') +
      '</button>';
  }

  function tarjetaTemplate(t) {
    var indice = Proceso.indiceColumna(t.columna);
    var po = poDe(t);
    // La línea de color de la izquierda dice en qué área está (azul, amarilla,
    // morada o verde: ver .tarjeta--* en css/styles.css). Se valida contra el
    // catálogo de columnas para que una columna desconocida no invente un color.
    var claseColumna = indice >= 0 ? ' tarjeta--' + t.columna : '';
    // El ensamble: el botón aparece desde «Trabajo» en adelante (ver
    // ENSAMBLE_DESDE) y sólo si la cotización tiene clickers con receta —es la
    // receta de armado, letra por letra, en una ventana aparte (abrirEnsamble)—.
    // Se calcula acá para saber si hay algo que armar; el contenido de la ventana
    // se arma al abrirla.
    var recetas = recetasDe(t);

    return '' +
      '<article class="tarjeta' +
        claseColumna +
        (t.pagado ? ' tarjeta--pagado' : '') + '"' +
        ' data-id="' + Utils.escapeHtml(t.id) + '" tabindex="0">' +
        '<div class="tarjeta__top">' +
          '<span class="tarjeta__folio">' + Utils.escapeHtml(PDF.folioTexto(t.folio)) + '</span>' +
          '<span class="tarjeta__total">' + Utils.formatMoney(t.total) + '</span>' +
        '</div>' +
        pagadoTemplate(t) +
        '<p class="tarjeta__cliente">' + clienteTemplate(t) + '</p>' +
        '<p class="tarjeta__meta">' +
          Utils.escapeHtml(PDF.fechaTexto(t.fecha)) + ' \u00b7 ' +
          t.unidades + (t.unidades === 1 ? ' pieza' : ' piezas') + ' \u00b7 ' +
          t.items.length + (t.items.length === 1 ? ' l\u00ednea' : ' l\u00edneas') +
        '</p>' +
        '<p class="tarjeta__resumen">' + Utils.escapeHtml(resumenProductos(t.items)) + '</p>' +
        (t.descuento > 0
          ? '<p class="tarjeta__descuento">Descuento \u2212' + Utils.formatMoney(t.descuento) +
              (t.descuentoNota ? ' \u00b7 ' + Utils.escapeHtml(t.descuentoNota) : '') + '</p>'
          : '') +
        (po
          ? '<p class="tarjeta__po"><b>PO:</b> ' +
              Utils.escapeHtml(poResumenTexto(po.totales)) + '</p>'
          : '') +
        '<div class="tarjeta__acciones">' +
          moverBotonTemplate(indice, -1) +
          moverBotonTemplate(indice, 1) +
          '<span class="tarjeta__iconos">' +
            (recetas.length
              ? '<button class="btn-ensamble" type="button" data-ensamble ' +
                  'title="Ensamble: qu\u00e9 base, qu\u00e9 tecla y qu\u00e9 color de letra lleva cada ' +
                  'letra del nombre" aria-label="Ver el ensamble, letra por letra">Ensamble</button>'
              : '') +
            (po
              ? '<button class="btn-po" type="button" data-po ' +
                  'title="Orden de producci\u00f3n: qu\u00e9 fabricar, agrupado por color y por ' +
                  'orden de colores" aria-label="Ver la orden de producci\u00f3n">PO</button>'
              : '') +
            '<button class="btn-ver" type="button" data-editar ' +
              'title="Editar la cotizaci\u00f3n: agregar o quitar productos, corregir datos" ' +
              'aria-label="Editar la cotizaci\u00f3n">' +
              '<span aria-hidden="true">\u270f\ufe0f</span>Editar</button>' +
            '<button class="btn-ver" type="button" data-ver ' +
              'title="Ver la cotizaci\u00f3n completa, sin descargar nada" ' +
              'aria-label="Ver la cotizaci\u00f3n completa">' +
              '<span aria-hidden="true">\ud83d\udc41</span>Ver</button>' +
            '<button class="icon-btn icon-btn--mini icon-btn--mini-danger" type="button" data-quitar ' +
              'title="Quitar del tablero" aria-label="Quitar del tablero">\u2715</button>' +
          '</span>' +
        '</div>' +
        '<details class="tarjeta__detalle"' + (abiertas[t.id] ? ' open' : '') + '>' +
          '<summary>Detalle para fabricar</summary>' +
          '<ul class="t-lineas">' + lineasTemplate(t.items) + '</ul>' +
          lotesTemplate(po, t) +
          (t.notas
            ? '<p class="tarjeta__notas"><b>Notas:</b> ' + Utils.escapeHtml(t.notas) + '</p>'
            : '') +
          '<p class="tarjeta__pie">Enviada el ' + Utils.escapeHtml(fechaHora(t.creada)) +
            (t.movida !== t.creada
              ? ' \u00b7 Movida el ' + Utils.escapeHtml(fechaHora(t.movida))
              : '') +
          '</p>' +
        '</details>' +
      '</article>';
  }

  // Qué hacer para que la columna deje de estar vacía (ahora sin arrastrar nada).
  function vacioTemplate(col) {
    var indice = Proceso.indiceColumna(col.id);
    if (indice === 0) return 'Env\u00eda una cotizaci\u00f3n desde el carrito y aparecer\u00e1 aqu\u00ed.';
    return 'A\u00fan no hay ninguna: en una tarjeta de ' + Proceso.COLUMNAS[indice - 1].nombre +
      ' pulsa \u00ab' + col.nombre + ' \u2192\u00bb.';
  }

  function columnaTemplate(col) {
    var lista = Proceso.getTarjetas(col.id);
    var unidades = 0;
    var dinero = 0;
    lista.forEach(function (t) { unidades += t.unidades; dinero += t.total; });

    return '' +
      '<section class="kanban__col' + (col.id === columnaActiva ? ' kanban__col--activa' : '') +
        '" data-col="' + col.id + '">' +
        '<header class="kanban__head">' +
          '<h3 class="kanban__title">' + Utils.escapeHtml(col.nombre) + '</h3>' +
          '<span class="kanban__count" title="' + lista.length + ' cotizaciones \u00b7 ' +
            unidades + ' piezas">' + lista.length + ' \u00b7 ' + Utils.formatMoney(dinero) + '</span>' +
        '</header>' +
        '<div class="kanban__body">' +
          (lista.length
            ? lista.map(tarjetaTemplate).join('')
            : '<p class="kanban__empty">' + vacioTemplate(col) + '</p>') +
        '</div>' +
      '</section>';
  }

  // Las pestañas del celular: una por columna, con cuántas tarjetas tiene cada una.
  // En la PC no se ven (el CSS las esconde): ahí están las cuatro columnas a la vez.
  function pestanasTemplate() {
    return '' +
      '<div class="kanban__tabs" role="tablist" aria-label="Columnas del tablero">' +
        Proceso.COLUMNAS.map(function (col) {
          var activa = col.id === columnaActiva;
          return '<button class="kanban__tab' + (activa ? ' kanban__tab--activa' : '') + '" type="button" ' +
            'role="tab" aria-selected="' + activa + '" data-tab="' + col.id + '">' +
            '<span class="kanban__tab-nombre">' + Utils.escapeHtml(col.nombre) + '</span>' +
            '<b class="kanban__tab-cuenta">' + Proceso.getTarjetas(col.id).length + '</b>' +
          '</button>';
        }).join('') +
      '</div>';
  }

  /* ------------------------------ Ensamble ------------------------------
     La receta de armado, en una ventana propia y con el mismo comportamiento
     que el visor de la hoja (window.PDF): se cierra con Esc, con un clic
     afuera o con su botón, y al cerrarse se borra del DOM (no queda colgado
     nada si la cotización cambia de columna o se borra). Los datos son de
     window.PO: letra por letra, en el orden del nombre, con la base (color y
     acabado cada uno en su columna), la tecla y el color de la letra impresa.
     Los llaveros no tienen letras: van en su propio bloque, en corto. */

  var ensambleEl = null;

  function cerrarEnsamble() {
    if (!ensambleEl) return;
    var el = ensambleEl;
    ensambleEl = null;                 // antes de cerrar: 'close' vuelve a entrar acá
    if (el.open) el.close();
    el.remove();
  }

  // Cada dato lleva su encabezado en data-campo: en el móvil la tabla se rearma
  // como bloques y el rótulo sale de ahí (ver .ensamble__tabla en styles.css).
  function ensambleFilaTemplate(l) {
    return '' +
      '<tr>' +
        '<td class="ensamble__letra">' + Utils.escapeHtml(l.caracter) +
          (l.simbolo ? ' <span class="ensamble__simbolo">s\u00edmbolo</span>' : '') + '</td>' +
        '<td data-campo="Color de base">' + colorTexto('', l.base.nombre, l.base.hex) + '</td>' +
        '<td data-campo="Estilo de base">' + (l.acabado
          ? Utils.escapeHtml(l.acabado)
          : '<span class="ensamble__vacio">\u2014</span>') + '</td>' +
        '<td data-campo="Color tecla">' + colorTexto('', l.tecla.nombre, l.tecla.hex) + '</td>' +
        '<td data-campo="Color de letra">' + colorTexto('', l.letra.nombre, l.letra.hex) + '</td>' +
      '</tr>';
  }

  // Un clicker por bloque: su nombre, cuántos son y una fila por letra.
  function ensambleBloqueTemplate(receta) {
    return '' +
      '<section class="ensamble__bloque">' +
        '<h3 class="ensamble__nombre">' + Utils.escapeHtml(receta.nombre) +
          '<span class="ensamble__cant">' + receta.cantidad +
          (receta.cantidad === 1 ? ' clicker' : ' clickers') + '</span></h3>' +
        '<p class="ensamble__nota">Una fila por letra, en el orden del nombre; la receta es de un clicker.</p>' +
        '<table class="ensamble__tabla">' +
          '<thead><tr>' +
            '<th>Letra</th>' +
            '<th>Color de base</th>' +
            '<th>Estilo de base</th>' +
            '<th>Color tecla</th>' +
            '<th>Color de letra</th>' +
          '</tr></thead>' +
          '<tbody>' + receta.letras.map(ensambleFilaTemplate).join('') + '</tbody>' +
        '</table>' +
      '</section>';
  }

  // Los llaveros, en corto: cuerpo y nombre de arriba, cada uno de su color.
  function ensambleLlaverosTemplate(llavos) {
    var cuantos = llavos.reduce(function (suma, g) { return suma + g.cantidad; }, 0);
    var filas = llavos.map(function (g) {
      var piezas = g.piezas || [];
      var cuerpo = piezas[0] || { nombre: '', hex: '' };
      var nombre = piezas.slice(1);
      return '' +
        '<tr>' +
          '<td class="ensamble__cant-cel" data-campo="Cant.">' + g.cantidad + '</td>' +
          '<td data-campo="Cuerpo">' + colorTexto('', cuerpo.nombre, cuerpo.hex) + '</td>' +
          '<td data-campo="Nombre impreso">' + (nombre.length ? coloresTexto(nombre) : '') +
            (g.titulos.length
              ? '<span class="ensamble__titulos">' + titulosTexto(g.titulos) + '</span>'
              : '') + '</td>' +
        '</tr>';
    });

    return '' +
      '<section class="ensamble__bloque">' +
        '<h3 class="ensamble__nombre">Llaveros' +
          '<span class="ensamble__cant">' + cuantos +
          (cuantos === 1 ? ' llavero' : ' llaveros') + '</span></h3>' +
        '<p class="ensamble__nota">Cuerpo y nombre de arriba, cada uno de su color.</p>' +
        '<table class="ensamble__tabla">' +
          '<thead><tr><th>Cant.</th><th>Cuerpo</th><th>Nombre impreso</th></tr></thead>' +
          '<tbody>' + filas.join('') + '</tbody>' +
        '</table>' +
      '</section>';
  }

  // Abre la ventana. Devuelve true si había algo que mostrar (si no, no se
  // asoma nada: la cotización no tiene clickers con receta).
  function abrirEnsamble(t) {
    var recetas = PO && PO.ensamble ? PO.ensamble(t.items) : [];
    var po = poDe(t);
    var llavos = po ? po.llaveros : [];
    if (!recetas.length && !llavos.length) return false;
    if (typeof document.createElement('dialog').showModal !== 'function') return false;

    cerrarEnsamble();

    var dlg = document.createElement('dialog');
    dlg.className = 'ensamble';
    dlg.innerHTML = '' +
      '<header class="ensamble__head">' +
        '<div>' +
          '<h2 class="ensamble__title">Ensamble</h2>' +
          '<p class="ensamble__meta">' + Utils.escapeHtml(PDF.folioTexto(t.folio)) +
            ' \u00b7 ' + Utils.escapeHtml(t.cliente || 'Sin cliente') +
            ' \u00b7 ' + Utils.escapeHtml(PDF.fechaTexto(t.fecha)) + '</p>' +
        '</div>' +
        '<button class="icon-btn ensamble__cerrar" type="button" data-cerrar ' +
          'title="Cerrar" aria-label="Cerrar">\u2715</button>' +
      '</header>' +
      '<div class="ensamble__lienzo">' +
        recetas.map(ensambleBloqueTemplate).join('') +
        (llavos.length ? ensambleLlaverosTemplate(llavos) : '') +
      '</div>' +
      '<footer class="ensamble__pie">' +
        '<button class="btn" type="button" data-cerrar>Cerrar</button>' +
      '</footer>';

    dlg.addEventListener('click', function (e) {
      if (e.target.closest('[data-cerrar]')) { cerrarEnsamble(); return; }
      if (e.target === dlg) cerrarEnsamble();      // clic en el fondo oscuro
    });
    dlg.addEventListener('close', cerrarEnsamble);  // Esc y el botón del navegador

    document.body.appendChild(dlg);
    dlg.showModal();
    ensambleEl = dlg;
    return true;
  }

  /* ---------------------------- Pintado ---------------------------- */

  function render(container) {
    if (container) rootEl = container;
    if (!rootEl) return;

    // Si quedó una tarjeta en el aire —por ejemplo, cambiaron de pestaña en medio de un
    // arrastre— se baja sin tocar nada: el repintado la vuelve a poner en su lugar.
    if (arrastre) desarmarArrastre();

    rootEl.innerHTML =
      '<div class="page">' +
        headTemplate() +
        pestanasTemplate() +
        '<div class="kanban" id="kanban">' +
          Proceso.COLUMNAS.map(columnaTemplate).join('') +
        '</div>' +
      '</div>';

    bind();
  }

  /* ------------------------- Interacciones ------------------------- */

  function mover(id, columna) {
    var tarjeta = Proceso.mover(id, columna);
    if (!tarjeta) return null;
    window.App.toast('Cotizaci\u00f3n ' + PDF.folioTexto(tarjeta.folio) + ' \u2192 ' +
      Proceso.getColumna(tarjeta.columna).nombre, 'success');
    return tarjeta;
  }

  // Salta una columna atrás/adelante: lo que hacen los botones de la tarjeta.
  function moverPaso(id, paso) {
    var tarjeta = Proceso.getTarjeta(id);
    if (!tarjeta) return;
    var destino = Proceso.COLUMNAS[Proceso.indiceColumna(tarjeta.columna) + paso];
    if (!destino) return;
    if (!mover(id, destino.id)) return;

    // El tablero se repinta: devolvemos el foco a la tarjeta movida.
    var el = rootEl && rootEl.querySelector('.tarjeta[data-id="' + id + '"]');
    if (el) el.focus();
  }

  // Corregir el nombre del cliente sin salir del tablero: el nombre se vuelve un
  // campo (ver [data-cliente]), se guarda con Enter o al salir del campo y se
  // cancela con Esc (queda el nombre de antes). Lo guarda Proceso.cambiarCliente,
  // que pinta al instante y repinta el tablero; si no había nada que cambiar —o si
  // se canceló— el nombre vuelve a su lugar sin tocar el resto del tablero, y así
  // el clic que cerró el campo (por ejemplo en otra tarjeta) sigue su camino.
  function editarCliente(id) {
    var t = Proceso.getTarjeta(id);
    var tarjetaEl = rootEl && rootEl.querySelector('.tarjeta[data-id="' + id + '"]');
    var caja = tarjetaEl && tarjetaEl.querySelector('.tarjeta__cliente');
    if (!t || !caja || caja.querySelector('input')) return;   // ya hay un campo abierto

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tarjeta__cliente-input';
    input.value = t.cliente;
    input.maxLength = Proceso.CLIENTE_MAX;
    input.placeholder = 'Sin cliente';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Nombre del cliente');
    caja.innerHTML = '';
    caja.appendChild(input);
    input.focus();
    input.select();

    var cerrado = false;   // Esc y blur no guardan dos veces
    function cerrar(guardar) {
      if (cerrado) return;
      cerrado = true;
      var nombre = input.value;
      if (!guardar || !Proceso.cambiarCliente(id, nombre)) {
        caja.innerHTML = clienteTemplate(Proceso.getTarjeta(id) || t);
      }
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); cerrar(true); }
      else if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
    });
    input.addEventListener('blur', function () { cerrar(true); });
  }

  /* -------------------------- Arrastrar y soltar --------------------------
     Llevar una tarjeta a otro lugar de su columna —o a otra columna— con el dedo o con
     el mouse. Va con eventos de PUNTERO (pointerdown / pointermove / pointerup), que son
     los mismos para los dos, así que hay un solo camino:

      · En la PC se agarra a los 6 px de movimiento: un clic suelto no arrastra nada.
      · En el móvil hay que MANTENER PULSADO (320 ms) y recién ahí arrastrar. Si el dedo
        se mueve antes de tiempo, el gesto se suelta y la página hace su scroll de
        siempre: es el motivo por el que este tablero se quedó sin arrastre la primera
        vez (el dedo y el scroll se peleaban).
      · La tarjeta levantada flota pegada al puntero (position: fixed, colgada del body
        para que nada la recorte) y en su lugar queda un HUECO punteado que se va moviendo
        por donde va a caer; la columna destino se resalta.
      · Al soltar, Proceso.reordenar() la mete en ese hueco —el punto medio entre las
        vecinas—, lo pinta al instante y lo manda al servidor. Esc (o que el navegador
        corte el gesto) devuelve todo a su lugar.
      · Mientras dura, el tablero se congela (Proceso.arrastrando): ni el sondeo de cada
        15 s ni un repintado le mueven el piso justo debajo de la mano.

     Nada de esto arranca desde un control de la tarjeta (botón, campo, tilde, «Detalle»):
     ahí el gesto es el de siempre. Los botones ← / → siguen estando, y son lo más cómodo
     para mover una tarjeta de a una columna con el teclado. */

  var PULSADO_MS = 320;     // el dedo tiene que quedarse quieto este rato para agarrar
  var UMBRAL_PC = 6;        // px de movimiento para agarrar con el mouse
  var UMBRAL_DEDO = 8;      // px: si el dedo se mueve más antes de tiempo, era scroll
  var BORDE_SCROLL = 70;    // px desde el borde de la pantalla donde se auto-desplaza

  var gesto = null;         // puntero apoyado, todavía sin agarrar nada
  var arrastre = null;      // la tarjeta levantada (y su hueco)
  var finArrastre = 0;      // cuándo terminó el último arrastre (el clic de atrás no cuenta)

  function esDedo(e) { return e.pointerType === 'touch' || e.pointerType === 'pen'; }

  // El puntero se apoyó sobre la tarjeta: queda a la espera. Se engancha en document (y no
  // en el contenedor) porque el dedo se va a otra parte de la pantalla y el gesto tiene
  // que seguirlo.
  function empezarGesto(e, tarjetaEl) {
    gesto = {
      el: tarjetaEl,
      id: tarjetaEl.getAttribute('data-id'),
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      dedo: esDedo(e),
      espera: null
    };
    document.addEventListener('pointermove', seguirGesto);
    document.addEventListener('pointerup', terminarGesto);
    document.addEventListener('pointercancel', terminarGesto);

    // Con el dedo, la señal de «quiero moverla» es quedarse quieto un momento. Hasta que
    // no pasa ese rato, la página puede scrollear sin que le estorbemos.
    if (gesto.dedo) {
      gesto.espera = setTimeout(function () {
        if (!gesto) return;
        gesto.espera = null;
        if (!gesto.el.isConnected) { cancelarGesto(); return; }   // se repintó: ya no está
        levantar(gesto.x, gesto.y);
      }, PULSADO_MS);
    }
  }

  function seguirGesto(e) {
    if (!gesto) return;
    gesto.x = e.clientX;
    gesto.y = e.clientY;
    if (arrastre) { moverArrastre(e.clientX, e.clientY); return; }

    var lejos = Math.abs(e.clientX - gesto.x0) + Math.abs(e.clientY - gesto.y0);
    if (gesto.dedo) {
      // Se movió antes de tiempo: es el scroll de la página. Se suelta el gesto.
      if (lejos > UMBRAL_DEDO) cancelarGesto();
      return;
    }
    if (lejos > UMBRAL_PC) levantar(e.clientX, e.clientY);
  }

  // El puntero se levantó (o el navegador canceló el gesto): se suelta lo que haya.
  function terminarGesto(e) {
    if (!gesto) return;
    var cortado = !!e && e.type === 'pointercancel';
    if (gesto.espera) clearTimeout(gesto.espera);
    gesto = null;
    desenganchar();
    if (!arrastre) return;
    if (cortado) cancelarArrastre();
    else soltarArrastre();
  }

  // Se suelta el gesto sin arrastrar nada (el dedo se movió antes de tiempo).
  function cancelarGesto() {
    if (!gesto) return;
    if (gesto.espera) clearTimeout(gesto.espera);
    gesto = null;
    desenganchar();
  }

  function desenganchar() {
    document.removeEventListener('pointermove', seguirGesto);
    document.removeEventListener('pointerup', terminarGesto);
    document.removeEventListener('pointercancel', terminarGesto);
  }

  // Levanta la tarjeta: se mide, se deja el hueco en su lugar y ella se va a flotar. El
  // hueco es lo que muestra dónde va a caer: se mueve con el puntero (ver ubicarHueco).
  function levantar(x, y) {
    if (!gesto || arrastre || !gesto.el.isConnected) return;
    var el = gesto.el;
    var caja = el.getBoundingClientRect();

    var hueco = document.createElement('div');
    hueco.className = 'kanban__hueco';
    hueco.style.height = Math.round(caja.height) + 'px';
    hueco.setAttribute('aria-hidden', 'true');

    arrastre = {
      id: gesto.id,
      el: el,
      hueco: hueco,
      dx: x - caja.left,   // dónde agarró la tarjeta: no se mueve de ahí bajo el puntero
      dy: y - caja.top
    };

    el.parentNode.insertBefore(hueco, el);
    el.classList.add('tarjeta--volando');
    el.style.width = caja.width + 'px';
    el.style.height = caja.height + 'px';
    el.style.left = caja.left + 'px';
    el.style.top = caja.top + 'px';
    document.body.appendChild(el);

    // Sin texto seleccionado por el camino (el mouse arrastra con el botón apretado).
    var seleccion = window.getSelection ? window.getSelection() : null;
    if (seleccion && seleccion.removeAllRanges) seleccion.removeAllRanges();

    document.body.classList.add('arrastrando');
    Proceso.arrastrando(true);     // el tablero se queda quieto mientras dure el gesto
    document.addEventListener('touchmove', evitaScroll, { passive: false });
    document.addEventListener('keydown', teclaArrastre);
    ubicarHueco(x, y);
  }

  function moverArrastre(x, y) {
    if (!arrastre) return;
    arrastre.el.style.left = (x - arrastre.dx) + 'px';
    arrastre.el.style.top = (y - arrastre.dy) + 'px';
    ubicarHueco(x, y);
    desplazarBorde(y);
  }

  // Dónde iría la tarjeta si la soltara acá: el hueco es la respuesta. Se busca la columna
  // que está debajo del puntero y, dentro de ella, la primera tarjeta cuya mitad de arriba
  // todavía no pasó: el hueco va justo antes de esa. Sin nada debajo del tablero, el hueco
  // se queda donde estaba (soltar afuera no cambia nada).
  function ubicarHueco(x, y) {
    var bajo = document.elementFromPoint(x, y);
    var col = bajo && bajo.closest ? bajo.closest('.kanban__col') : null;
    if (!col) return;

    var cuerpo = col.querySelector('.kanban__body');
    if (cuerpo) {
      var hermanas = cuerpo.querySelectorAll('.tarjeta');
      var antesDe = null;
      for (var i = 0; i < hermanas.length; i++) {
        var caja = hermanas[i].getBoundingClientRect();
        if (y < caja.top + caja.height / 2) { antesDe = hermanas[i]; break; }
      }
      if (antesDe) cuerpo.insertBefore(arrastre.hueco, antesDe);
      else cuerpo.appendChild(arrastre.hueco);
    }
    resaltarColumna(col);
  }

  function resaltarColumna(col) {
    if (!rootEl) return;
    var todas = rootEl.querySelectorAll('.kanban__col');
    for (var i = 0; i < todas.length; i++) {
      todas[i].classList.toggle('kanban__col--destino', todas[i] === col);
    }
  }

  function sinResaltar() {
    if (!rootEl) return;
    var todas = rootEl.querySelectorAll('.kanban__col');
    for (var i = 0; i < todas.length; i++) todas[i].classList.remove('kanban__col--destino');
  }

  // Con la tarjeta en la mano, el puntero puede llegar al borde: la página se desplaza
  // sola para poder soltarla más arriba o más abajo (la tarjeta flota, así que se queda
  // pegada al puntero).
  function desplazarBorde(y) {
    if (y < BORDE_SCROLL) window.scrollBy(0, -16);
    else if (y > window.innerHeight - BORDE_SCROLL) window.scrollBy(0, 16);
  }

  // El dedo no scrollea mientras hay una tarjeta levantada: el gesto es arrastrar.
  function evitaScroll(e) {
    if (arrastre) e.preventDefault();
  }

  function teclaArrastre(e) {
    if (e.key === 'Escape' && arrastre) {
      e.preventDefault();
      cancelarArrastre();
    }
  }

  // Se soltó la tarjeta: se miran sus vecinas del hueco —la de arriba y la de abajo— y
  // Proceso.reordenar() la mete entre las dos (el punto medio de la posición). El
  // repintado lo dispara el propio Proceso, así que la tarjeta aparece en su lugar de
  // verdad; si no había nada que cambiar, se repinta igual, porque estaba flotando.
  function soltarArrastre() {
    var hueco = arrastre.hueco;
    var cuerpo = hueco.parentNode;
    var col = cuerpo && cuerpo.closest ? cuerpo.closest('.kanban__col') : null;
    var columna = col ? col.getAttribute('data-col') : '';
    var antes = vecina(hueco, 'previousElementSibling');
    var despues = vecina(hueco, 'nextElementSibling');
    var id = arrastre.id;
    var original = Proceso.getTarjeta(id);

    desarmarArrastre();

    if (!columna) { render(); return; }   // la soltó fuera del tablero: no cambia nada

    var tarjeta = Proceso.reordenar(id, columna, antes, despues);
    if (!tarjeta) { render(); return; }   // quedó en el mismo lugar

    var destino = Proceso.getColumna(tarjeta.columna).nombre;
    var folio = PDF.folioTexto(tarjeta.folio);
    window.App.toast(original && original.columna !== tarjeta.columna
      ? 'Cotización ' + folio + ' \u2192 ' + destino
      : 'Cotización ' + folio + ' \u00b7 nuevo orden en ' + destino, 'success');
  }

  // Se canceló (Esc, o el navegador cortó el gesto): no cambió nada, así que alcanza con
  // bajar la tarjeta y repintar el tablero tal como estaba.
  function cancelarArrastre() {
    desarmarArrastre();
    render();
  }

  // Baja la tarjeta que flotaba, borra el hueco y descongela el tablero. La tarjeta se
  // saca del DOM (estaba colgada del body) y el repintado la devuelve a su lugar.
  function desarmarArrastre() {
    if (!arrastre) return;
    if (arrastre.hueco && arrastre.hueco.parentNode) {
      arrastre.hueco.parentNode.removeChild(arrastre.hueco);
    }
    if (arrastre.el.parentNode) arrastre.el.parentNode.removeChild(arrastre.el);
    arrastre = null;
    document.body.classList.remove('arrastrando');
    document.removeEventListener('touchmove', evitaScroll, { passive: false });
    document.removeEventListener('keydown', teclaArrastre);
    sinResaltar();
    Proceso.arrastrando(false);
    // El clic que el navegador dispara atrás de un arrastre (soltar el botón también es un
    // clic) no es un clic: se anota la hora para que el listener de click lo deje pasar.
    finArrastre = Date.now();
  }

  // La tarjeta anterior (o siguiente) del hueco dentro de su columna: las vecinas entre
  // las que va a caer. Se saltea lo que no sea tarjeta (el cartel de columna vacía).
  function vecina(el, direccion) {
    var paso = el[direccion];
    while (paso && !(paso.classList && paso.classList.contains('tarjeta'))) paso = paso[direccion];
    return paso ? paso.getAttribute('data-id') : null;
  }

  // Listeners delegados sobre el contenedor: no hay que reengancharlos cada vez
  // que se repinta ni al volver a entrar a la ruta.
  function bind() {
    if (boundEl === rootEl) return;
    boundEl = rootEl;

    rootEl.addEventListener('click', function (e) {
      // Pestañas del celular: se cambia de columna sin repintar todo el tablero.
      var pestana = e.target.closest('[data-tab]');
      if (pestana) {
        columnaActiva = pestana.getAttribute('data-tab');
        rootEl.querySelectorAll('[data-tab]').forEach(function (b) {
          var activa = b.getAttribute('data-tab') === columnaActiva;
          b.classList.toggle('kanban__tab--activa', activa);
          b.setAttribute('aria-selected', activa);
        });
        rootEl.querySelectorAll('.kanban__col').forEach(function (c) {
          c.classList.toggle('kanban__col--activa', c.getAttribute('data-col') === columnaActiva);
        });
        return;
      }

      // El clic que el navegador dispara atrás de un arrastre (soltar el botón también
      // cuenta como clic) no es un clic: se descarta el que llega pegadito al arrastre.
      if (Date.now() - finArrastre < 400) return;

      var tarjetaEl = e.target.closest('.tarjeta');
      if (!tarjetaEl) return;
      var id = tarjetaEl.getAttribute('data-id');

      var paso = e.target.closest('[data-mover]');
      if (paso) {
        moverPaso(id, paso.getAttribute('data-mover') === 'siguiente' ? 1 : -1);
        return;
      }

      // El nombre del cliente: se corrige ahí mismo, sin salir del tablero (el
      // botón se vuelve un campo, ver editarCliente).
      if (e.target.closest('[data-cliente]')) {
        editarCliente(id);
        return;
      }

      // Editar la cotización: sus líneas pasan al carrito y se regresa a Productos
      // para agregar o quitar lo que haga falta (ver Cart.empezarEdicion).
      if (e.target.closest('[data-editar]')) {
        editarCotizacion(id);
        return;
      }

      // Ver la cotización completa en pantalla, sin descargar nada.
      if (e.target.closest('[data-ver]')) {
        var c = Proceso.getTarjeta(id);
        if (c) PDF.ver({ meta: c, items: c.items });
        return;
      }

      // La orden de producción: la hoja con lo que hay que fabricar, agrupado
      // por color (y por orden de colores). Se arma al vuelo desde la tarjeta.
      if (e.target.closest('[data-po]')) {
        var p = Proceso.getTarjeta(id);
        if (!p) return;
        PDF.verPO({
          meta: p,
          items: p.items,
          etapa: Proceso.getColumna(p.columna).nombre
        });
        return;
      }

      // El ensamble: la receta de armado de cada clicker, letra por letra.
      if (e.target.closest('[data-ensamble]')) {
        var ens = Proceso.getTarjeta(id);
        if (ens) abrirEnsamble(ens);
        return;
      }

      if (e.target.closest('[data-quitar]')) {
        var q = Proceso.getTarjeta(id);
        if (!q) return;
        var folio = PDF.folioTexto(q.folio);
        if (!window.confirm('\u00bfQuitar la cotizaci\u00f3n ' + folio + ' del tablero?')) return;
        Proceso.remove(id);
        window.App.toast('Cotizaci\u00f3n ' + folio + ' quitada del tablero');
      }
    });

    // El arrastre arranca acá: el puntero se apoya sobre una tarjeta y, según sea mouse o
    // dedo, se levanta enseguida o después de mantener pulsado (ver la sección de arriba).
    // Desde los controles de la tarjeta (botones, campos, tilde, «Detalle») NO se arrastra:
    // ahí el gesto sigue siendo el de siempre.
    rootEl.addEventListener('pointerdown', function (e) {
      if (arrastre) return;                                   // ya hay una en la mano
      if (e.button && e.button !== 0) return;                  // sólo el botón principal
      if (!e.target || typeof e.target.closest !== 'function') return;

      var tarjetaEl = e.target.closest('.tarjeta');
      if (!tarjetaEl) return;
      if (e.target.closest('button, input, label, summary, a, select, textarea, details')) return;

      empezarGesto(e, tarjetaEl);
    });

    // Los tildes de la tarjeta: el de «Pagado» y los del taller (qué tandas del
    // desglose ya están hechas). Se pintan al instante y se mandan al servidor por
    // atrás (Proceso.cambiarPagado / cambiarListas; si falla, el tablero vuelve
    // atrás y avisa).
    rootEl.addEventListener('change', function (e) {
      if (!e.target || typeof e.target.closest !== 'function') return;
      var tarjetaEl = e.target.closest('.tarjeta');
      if (!tarjetaEl) return;
      var id = tarjetaEl.getAttribute('data-id');

      var casilla = e.target.closest('[data-pagado]');
      if (casilla) { Proceso.cambiarPagado(id, casilla.checked); return; }

      // Las casillas del taller van de a dos (bases y teclas): se manda la pareja,
      // con la que se acaba de tocar cambiada y la otra como está.
      var tanda = e.target.closest('[data-listas]');
      if (!tanda) return;
      var t = Proceso.getTarjeta(id);
      if (!t) return;
      var listas = { bases: t.basesListas, teclas: t.teclasListas };
      listas[tanda.getAttribute('data-listas')] = tanda.checked;
      Proceso.cambiarListas(id, listas);
    });

    // El detalle desplegado no se cierra al repintar (el evento 'toggle' no
    // burbujea, por eso se escucha en fase de captura).
    rootEl.addEventListener('toggle', function (e) {
      var detalle = e.target;
      if (!detalle.classList || !detalle.classList.contains('tarjeta__detalle')) return;
      var tarjetaEl = detalle.closest('.tarjeta');
      if (tarjetaEl) abiertas[tarjetaEl.getAttribute('data-id')] = detalle.open;
    }, true);
  }

  // El tablero es compartido: si cambia (desde aquí o al enviar una cotización
  // desde el carrito) se repinta, esté o no esta vista montada. Salvo que haya una
  // tarjeta en la mano: ahí el repintado tendría que esperar a que la suelten.
  Proceso.subscribe(function () {
    if (arrastre) return;
    if (rootEl && rootEl.querySelector('#kanban')) render();
  });

  window.Views = window.Views || {};
  window.Views.proceso = { render: render };
})();
