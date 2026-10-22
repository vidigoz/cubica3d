/* Plantilla de la cotización en PDF + visor en pantalla + motor de impresión.
 * El diseño vive AQUÍ y en ningún otro lado: para replicar otro template basta
 * con editar NEGOCIO y documento(). Se expone como window.PDF */
(function () {
  'use strict';

  var Utils = window.Utils;

  /* --------------- Datos del negocio (EDITA AQUÍ) --------------- */
  var NEGOCIO = {
    nombre: 'Cubica3D',
    slogan: 'Cotizador de impresión 3D',
    // Ruta relativa al index.html. Si es null se usa la insignia con el texto "3D".
    logo: 'icons/cubica-logo.png',
    contacto: [],     // ej. ['WhatsApp 55 1234 5678', 'hola@cubica3d.mx']
    vigencia: '15 días naturales',
    pie: 'Gracias por tu preferencia. Precios en pesos mexicanos (MXN).'
  };

  function getNegocio() { return JSON.parse(JSON.stringify(NEGOCIO)); }

  /* --------------------------- Formato --------------------------- */

  // 1 -> "N° 0001"
  function folioTexto(valor) {
    var n = parseInt(valor, 10);
    var s = String(isFinite(n) && n > 0 ? n : 1);
    while (s.length < 4) s = '0' + s;
    return 'N° ' + s;
  }

  // '2026-10-09' -> '09/10/2026'
  function fechaTexto(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : String(iso || '');
  }

  // "Juan Pérez" -> "Juan-Perez" (para el nombre del archivo PDF)
  function slug(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
  }

  // Nombre sugerido del PDF = el <title> de la página al imprimir.
  // Sin argumentos usa los datos del carrito; con una cotización de paso (una
  // tarjeta del tablero de Proceso) usa esos datos.
  function nombreArchivo(metaFuente) {
    var meta = metaFuente || window.Cart.getMeta();
    var partes = ['Cotizacion', folioTexto(meta.folio).replace(/\D/g, '')];
    var quien = slug(meta.cliente);
    if (quien) partes.push(quien);
    return partes.join('-');
  }

  /* --------------------------- Cuentas ---------------------------
     Sirven igual para el carrito que para una tarjeta del tablero, por eso
     reciben las líneas y no leen de window.Cart. */

  // Cantidad siempre es un entero >= 1.
  function cantidadDe(item) {
    var n = Math.floor(Utils.parseNumber(item && item.cantidad, 1));
    return n > 0 ? n : 1;
  }

  // Importe de una línea: precio unitario × cantidad.
  function importeLinea(item) {
    return Utils.parseNumber(item && item.precio, 0) * cantidadDe(item);
  }

  function unidadesDe(items) {
    return (items || []).reduce(function (sum, item) { return sum + cantidadDe(item); }, 0);
  }

  function totalDe(items) {
    return (items || []).reduce(function (sum, item) { return sum + importeLinea(item); }, 0);
  }

  /* --------------------------- Pedacería --------------------------- */

  function marcaTemplate() {
    var marca = NEGOCIO.logo
      ? '<img class="hoja__logo-img" src="' + Utils.escapeHtml(NEGOCIO.logo) + '" alt="" />'
      : '<span class="hoja__logo">3D</span>';
    return '' +
      '<div class="hoja__marca">' + marca +
        '<div>' +
          '<h1 class="hoja__nombre">' + Utils.escapeHtml(NEGOCIO.nombre) + '</h1>' +
          '<p class="hoja__slogan">' + Utils.escapeHtml(NEGOCIO.slogan) + '</p>' +
        '</div>' +
      '</div>';
  }

  // "Base ●Negro  Nombre ●Rojo"
  function coloresTemplate(item) {
    return (item.detalles || []).map(function (d) {
      return '<span class="hoja__color">' + Utils.escapeHtml(d.label) +
        ' ' + Utils.marcaDetalle(d, 'hoja__dot') +
        Utils.escapeHtml(d.nombre) + '</span>';
    }).join('');
  }

  function filaTemplate(item, index) {
    return '' +
      '<tr>' +
        '<td class="ta-c">' + (index + 1) + '</td>' +
        '<td class="hoja__celda-prod"><b>' + Utils.escapeHtml(item.tipo) + '</b></td>' +
        '<td class="hoja__celda-detalle">' +
          (item.titulo
            ? '<span class="hoja__detalle-nombre">' + Utils.escapeHtml(item.titulo) + '</span>'
            : '') +
          '<span>' + coloresTemplate(item) + '</span>' +
        '</td>' +
        '<td class="ta-c">' + item.cantidad + '</td>' +
        '<td class="ta-r">' + Utils.formatMoney(item.precio) + '</td>' +
        '<td class="ta-r"><b>' + Utils.formatMoney(importeLinea(item)) + '</b></td>' +
      '</tr>';
  }

  function tablaTemplate(items) {
    if (!items.length) {
      return '<p class="hoja__vacio">Aún no hay productos en la cotización.</p>';
    }
    return '' +
      '<table class="hoja__tabla">' +
        '<thead>' +
          '<tr>' +
            '<th class="ta-c">#</th>' +
            '<th>Producto</th>' +
            '<th>Detalle</th>' +
            '<th class="ta-c">Cant.</th>' +
            '<th class="ta-r">P. unit.</th>' +
            '<th class="ta-r">Importe</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + items.map(filaTemplate).join('') + '</tbody>' +
      '</table>';
  }

  function totalesTemplate(unidades, total) {
    return '' +
      '<section class="hoja__totales">' +
        '<div class="hoja__total-caja">' +
          '<div class="hoja__total-row hoja__total-row--sub">' +
            '<span>Piezas</span><span>' + unidades + '</span>' +
          '</div>' +
          '<div class="hoja__total-row">' +
            '<span>Total</span><span>' + Utils.formatMoney(total) + '</span>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  /* --------------------------- Documento --------------------------- */

  // HTML completo de la hoja A4. Es el ÚNICO lugar donde se decide cómo se ve
  // la cotización: cámbialo aquí y cambia en pantalla y en el PDF a la vez.
  //
  // fuente: { meta, items } opcional. Sin argumentos dibuja lo que hay en el
  // carrito; con argumentos dibuja un snapshot (por ejemplo una tarjeta del
  // tablero de Proceso, para reimprimirla sin tocar el carrito).
  // idHoja: permite tener dos hojas en el DOM sin repetir el id (la vista
  // previa del carrito y el contenedor de impresión).
  function documento(fuente, idHoja) {
    var origen = fuente || {};
    var items = origen.items || window.Cart.getItems();
    var meta = origen.meta || window.Cart.getMeta();

    return '' +
      '<article class="hoja" id="' + Utils.escapeHtml(idHoja || 'cotizacion-hoja') + '">' +
        '<header class="hoja__head">' +
          marcaTemplate() +
          '<div class="hoja__folio">' +
            '<span class="hoja__folio-label">Cotización</span>' +
            '<span class="hoja__folio-num">' + Utils.escapeHtml(folioTexto(meta.folio)) + '</span>' +
            '<span class="hoja__folio-fecha">' + Utils.escapeHtml(fechaTexto(meta.fecha)) + '</span>' +
          '</div>' +
        '</header>' +

        '<section class="hoja__bloque">' +
          '<div>' +
            '<span class="hoja__label">Cliente</span>' +
            '<span class="hoja__cliente">' +
              (meta.cliente ? Utils.escapeHtml(meta.cliente) : '&mdash;') +
            '</span>' +
          '</div>' +
          '<div class="hoja__bloque-der">' +
            '<span class="hoja__label">Vigencia</span>' +
            '<span>' + Utils.escapeHtml(NEGOCIO.vigencia) + '</span>' +
          '</div>' +
        '</section>' +

        tablaTemplate(items) +
        totalesTemplate(unidadesDe(items), totalDe(items)) +

        (meta.notas
          ? '<section class="hoja__notas">' +
              '<span class="hoja__label">Notas</span>' +
              '<p>' + Utils.escapeHtml(meta.notas) + '</p>' +
            '</section>'
          : '') +

        pieTemplate() +
      '</article>';
  }

  // Pie de la hoja (contacto y agradecimiento): igual en las dos hojas.
  function pieTemplate() {
    var contacto = NEGOCIO.contacto.map(function (c) {
      return '<span>' + Utils.escapeHtml(c) + '</span>';
    }).join('');
    return '' +
      '<footer class="hoja__pie">' +
        '<span>' + Utils.escapeHtml(NEGOCIO.pie) + '</span>' +
        '<span class="hoja__contacto">' + contacto + '</span>' +
      '</footer>';
  }

  /* ------------------ Hoja de la orden de producción ------------------
     Es la misma hoja A4 que la cotización (marca, folio, pie y estilos), pero
     con lo que se fabrica: los productos vendidos y, debajo, las tandas ya
     agrupadas por window.PO. Sin precios.
     fuente: { meta, items, etapa } — `etapa` es la columna del tablero
     («Trabajo», «Realizado»), para saber de dónde salió la orden. */
  function documentoPO(fuente, idHoja) {
    var origen = fuente || {};
    var items = origen.items || [];
    var meta = origen.meta || {};
    var etapa = Utils.normalize(origen.etapa);
    if (!window.PO) return '';
    var po = window.PO.leer(items);
    if (po.vacia) return '';

    return '' +
      '<article class="hoja hoja--po" id="' + Utils.escapeHtml(idHoja || 'po-hoja') + '">' +
        '<header class="hoja__head">' +
          marcaTemplate() +
          '<div class="hoja__folio">' +
            '<span class="hoja__folio-label">Orden de producci\u00f3n</span>' +
            '<span class="hoja__folio-num">' + Utils.escapeHtml(folioTexto(meta.folio)) + '</span>' +
            '<span class="hoja__folio-fecha">' + Utils.escapeHtml(fechaTexto(meta.fecha)) + '</span>' +
          '</div>' +
        '</header>' +

        '<section class="hoja__bloque">' +
          '<div>' +
            '<span class="hoja__label">Cliente</span>' +
            '<span class="hoja__cliente">' +
              (meta.cliente ? Utils.escapeHtml(meta.cliente) : '&mdash;') +
            '</span>' +
          '</div>' +
          (etapa
            ? '<div><span class="hoja__label">Etapa</span><span>' +
              Utils.escapeHtml(etapa) + '</span></div>'
            : '') +
          '<div class="hoja__bloque-der">' +
            '<span class="hoja__label">A fabricar</span>' +
            '<span><b>' + po.totales.piezas + '</b> piezas \u00b7 ' +
              po.totales.grupos + ' grupos</span>' +
          '</div>' +
        '</section>' +

        poTotalesTemplate(po.totales) +
        poProductosTemplate(items) +
        poBasesTemplate(po.bases) +
        poTeclasTemplate(po.teclas) +
        poLlaverosTemplate(po.llaveros) +
        poOtrosTemplate(po.otros) +
        poMaterialesTemplate(po.materiales) +

        (meta.notas
          ? '<section class="hoja__notas">' +
              '<span class="hoja__label">Notas</span>' +
              '<p>' + Utils.escapeHtml(meta.notas) + '</p>' +
            '</section>'
          : '') +

        pieTemplate() +
      '</article>';
  }

  /* ------------------- Orden de producción (PO) -------------------
     Misma hoja A4 y misma marca que la cotización, pero con el contenido del
     taller: qué se fabrica, agrupado por tanda (las cuentas las hace window.PO).
     Se ve en el visor con PDF.verPO() y sale en papel con PDF.imprimirPO(),
     igual que la cotización. No lleva precios: la plata está en la cotización. */

  // «● Verde» con su nombre, como en la cotización.
  function poColorTemplate(pieza) {
    return '<span class="hoja__color">' +
      (pieza.label ? Utils.escapeHtml(pieza.label) + ' ' : '') +
      Utils.marcaDetalle(pieza, 'hoja__dot') +
      Utils.escapeHtml(pieza.nombre) + '</span>';
  }

  function poColoresTemplate(piezas) {
    return (piezas || []).map(poColorTemplate).join('');
  }

  // «A ×2 · L · I» — las formas que entran en la tanda (cuántas «A» imprimir).
  function poFormasTemplate(formas) {
    return (formas || []).map(function (f) {
      return Utils.escapeHtml(f.caracter) + (f.cantidad > 1 ? ' \u00d7' + f.cantidad : '');
    }).join(' \u00b7 ');
  }

  // «Luis ×2, Ana» — de qué líneas sale el grupo.
  function poTitulosTemplate(titulos) {
    return (titulos || []).map(function (t) {
      return Utils.escapeHtml(t.nombre) + (t.cantidad > 1 ? ' \u00d7' + t.cantidad : '');
    }).join(', ');
  }

  // Una tanda: título con cuántas piezas, una nota de qué agrupa y su tabla.
  function poSeccionTemplate(titulo, nota, encabezados, filas) {
    if (!filas.length) return '';
    return '' +
      '<section class="hoja__sec">' +
        '<h2 class="hoja__sec-title">' + Utils.escapeHtml(titulo) + '</h2>' +
        (nota ? '<p class="hoja__sec-nota">' + Utils.escapeHtml(nota) + '</p>' : '') +
        '<table class="hoja__tabla">' +
          '<thead><tr>' + encabezados.map(function (e) {
            return '<th' + (e.clase ? ' class="' + e.clase + '"' : '') + '>' +
              Utils.escapeHtml(e.texto) + '</th>';
          }).join('') + '</tr></thead>' +
          '<tbody>' + filas.join('') + '</tbody>' +
        '</table>' +
      '</section>';
  }

  // Lo que se vendió, línea por línea: el «qué» de la orden (el «cómo» son las
  // tandas de abajo). Los colores van en el orden en que se eligieron.
  function poProductosTemplate(items) {
    var filas = (items || []).map(function (item) {
      return '' +
        '<tr>' +
          '<td class="ta-c">' + cantidadDe(item) + '</td>' +
          '<td class="hoja__celda-prod"><b>' + Utils.escapeHtml(item.tipo) + '</b></td>' +
          '<td>' + (item.titulo ? Utils.escapeHtml(item.titulo) : '') + '</td>' +
          '<td>' + poColoresTemplate(item.detalles) + '</td>' +
        '</tr>';
    });
    return poSeccionTemplate('Productos a fabricar',
      'Una l\u00ednea por producto vendido, con sus colores en orden.',
      [{ texto: 'Cant.', clase: 'ta-c' }, { texto: 'Producto' }, { texto: 'Nombre' },
        { texto: 'Colores' }],
      filas);
  }
  // Cuántas piezas suman los grupos (va en el título de cada tanda).
  function poSuma(grupos) {
    return (grupos || []).reduce(function (suma, g) { return suma + g.cantidad; }, 0);
  }

  // Tandas de BASES del clicker: mismo color y acabado = mismo cuerpo y misma
  // impresión. La columna «Letras» dice qué formas entran (cuántas «A», etc.).
  function poBasesTemplate(grupos) {
    var filas = (grupos || []).map(function (g) {
      return '' +
        '<tr>' +
          '<td class="ta-c po-cant">' + g.cantidad + '</td>' +
          '<td>' +
            poColorTemplate({ label: '', nombre: g.nombre, hex: g.hex }) +
            (g.acabado ? '<span class="po-acabado">' + Utils.escapeHtml(g.acabado) + '</span>' : '') +
          '</td>' +
          '<td class="po-formas">' + poFormasTemplate(g.formas) + '</td>' +
        '</tr>';
    });
    return poSeccionTemplate('Bases del clicker (' + poSuma(grupos) + ')',
      'Todas las bases del mismo color y acabado se imprimen juntas.',
      [{ texto: 'Cant.', clase: 'ta-c' }, { texto: 'Base' }, { texto: 'Letras que lleva' }],
      filas);
  }

  // Tandas de TECLAS CON SU LETRA: la tecla y la letra de arriba van juntas, y
  // en ese orden. Una tecla roja con letra blanca y una blanca con letra roja
  // son dos tandas distintas.
  function poTeclasTemplate(grupos) {
    var filas = (grupos || []).map(function (g) {
      return '' +
        '<tr>' +
          '<td class="ta-c po-cant">' + g.cantidad + '</td>' +
          '<td>' +
            poColorTemplate({ label: 'Tecla', nombre: g.tecla.nombre, hex: g.tecla.hex }) +
            poColorTemplate({ label: 'Letra', nombre: g.letra.nombre, hex: g.letra.hex }) +
          '</td>' +
          '<td class="po-formas">' + poFormasTemplate(g.formas) + '</td>' +
        '</tr>';
    });
    return poSeccionTemplate('Teclas con su letra (' + poSuma(grupos) + ')',
      'La tecla y la letra de arriba son una sola tanda: se agrupan por el par, en ese orden.',
      [{ texto: 'Cant.', clase: 'ta-c' }, { texto: 'Tecla y letra' },
        { texto: 'Letras que lleva' }],
      filas);
  }

  // Grupos de LLAVEROS: mismo cuerpo y mismo nombre impreso = misma producción.
  // Adentro del grupo se listan los nombres que caen en esa combinación.
  function poLlaverosTemplate(grupos) {
    var filas = (grupos || []).map(function (g) {
      return '' +
        '<tr>' +
          '<td class="ta-c po-cant">' + g.cantidad + '</td>' +
          '<td>' + poColoresTemplate(g.piezas) + '</td>' +
          '<td>' + poTitulosTemplate(g.titulos) + '</td>' +
        '</tr>';
    });
    return poSeccionTemplate('Llaveros (' + poSuma(grupos) + ')',
      'Mismo cuerpo y mismo nombre impreso = misma producción. Los que comparten la combinación se hacen juntos.',
      [{ texto: 'Cant.', clase: 'ta-c' }, { texto: 'Combinación (en orden)' },
        { texto: 'Nombres' }],
      filas);
  }

  // Productos sin agrupación propia: se agrupan por su combinación de colores.
  function poOtrosTemplate(grupos) {
    var filas = (grupos || []).map(function (g) {
      return '' +
        '<tr>' +
          '<td class="ta-c po-cant">' + g.cantidad + '</td>' +
          '<td class="hoja__celda-prod"><b>' + Utils.escapeHtml(g.tipo) + '</b></td>' +
          '<td>' + poColoresTemplate(g.piezas) + '</td>' +
          '<td>' + poTitulosTemplate(g.titulos) + '</td>' +
        '</tr>';
    });
    return poSeccionTemplate('Otros productos (' + poSuma(grupos) + ')',
      'Se agrupan por su combinación de colores, tal como se cotizaron.',
      [{ texto: 'Cant.', clase: 'ta-c' }, { texto: 'Producto' }, { texto: 'Combinación' },
        { texto: 'Nombres' }],
      filas);
  }

  // Cuántas piezas de cada color: la lista para preparar los filamentos.
  function poMaterialesTemplate(materiales) {
    var filas = (materiales || []).map(function (m) {
      return '' +
        '<tr>' +
          '<td class="hoja__celda-prod">' + Utils.escapeHtml(m.producto) + '</td>' +
          '<td>' + Utils.escapeHtml(m.pieza) + '</td>' +
          '<td>' + poColorTemplate({ label: '', nombre: m.nombre, hex: m.hex }) + '</td>' +
          '<td class="ta-c po-cant">' + m.cantidad + '</td>' +
        '</tr>';
    });
    return poSeccionTemplate('Materiales por color',
      'Cuántas piezas de cada color hay que imprimir, sumando todos los grupos.',
      [{ texto: 'Producto' }, { texto: 'Pieza' }, { texto: 'Color' },
        { texto: 'Cant.', clase: 'ta-c' }],
      filas);
  }

  // Los números gruesos de la orden, arriba de todo.
  function poTotalesTemplate(totales) {
    function fila(etiqueta, valor, sub) {
      return '<div class="hoja__total-row' + (sub ? ' hoja__total-row--sub' : '') + '">' +
        '<span>' + Utils.escapeHtml(etiqueta) + '</span><span>' + valor + '</span></div>';
    }
    return '' +
      '<section class="po-totales">' +
        '<div class="hoja__total-caja">' +
          fila('Llaveros', totales.llaveros, true) +
          fila('Bases del clicker', totales.bases, true) +
          fila('Teclas con su letra', totales.teclas, true) +
          (totales.otros ? fila('Otros productos', totales.otros, true) : '') +
          fila('Grupos de producción', totales.grupos, true) +
          fila('Piezas a fabricar', totales.piezas, false) +
        '</div>' +
      '</section>';
  }




  /* ---------- La hoja encogida en la vista previa ----------
     Es la misma hoja A4 de documento(), pero encogida para entrar a lo ancho de
     la caja donde se muestre (la vista previa del carrito, ver .doc-preview en
     styles.css). Sin esto, en el móvil la hoja de 210mm se sale de la pantalla
     y hay que arrastrar de costado para leerla. El marco reserva el hueco ya
     encogido y la hoja se achica desde su esquina; nunca crece por encima de su
     tamaño real. Es el mismo truco del visor (ver ajustarVisor). Devuelve la
     escala que quedó (1 = tamaño real). */

  var marcoVista = null;      // la última vista previa dibujada
  var oyenteVista = null;     // su oyente de resize: uno solo para todas

  function encajarHoja(marco) {
    if (!marco || !marco.parentElement) return 1;
    var hoja = marco.querySelector('.hoja');
    if (!hoja) return 1;

    // Lo que se encoge es el bloque que envuelve la hoja (como en el visor: el
    // marco deja el hueco y el envoltorio es el que lleva la escala).
    var topo = (marco.firstElementChild === hoja || marco.firstElementChild.contains(hoja))
      ? marco.firstElementChild
      : hoja;

    // Girar el teléfono o abrir el teclado cambia el ancho: la hoja se vuelve a
    // encajar sola. El oyente se apaga solo cuando el marco ya no está en la
    // página (otra ruta, otro repintado).
    marcoVista = marco;
    if (!oyenteVista) {
      oyenteVista = function () {
        if (marcoVista && marcoVista.isConnected) encajarHoja(marcoVista);
      };
      window.addEventListener('resize', oyenteVista);
    }

    var caja = marco.parentElement;
    var estilo = window.getComputedStyle(caja);
    var disponible = caja.clientWidth -
      (parseFloat(estilo.paddingLeft) || 0) - (parseFloat(estilo.paddingRight) || 0);

    var ancho = hoja.offsetWidth;    // 210mm tal cual
    var alto = hoja.offsetHeight;    // 297mm tal cual
    var escala = Math.min(1, disponible / ancho);
    if (!isFinite(escala) || escala <= 0) escala = 1;

    marco.style.width = Math.round(ancho * escala) + 'px';
    marco.style.height = Math.round(alto * escala) + 'px';
    topo.style.transformOrigin = '0 0';    // se achica desde la esquina, no del centro
    topo.style.transform = 'scale(' + escala + ')';
    return escala;
  }

  /* -------------------- Visor en pantalla --------------------
     Enseña una hoja entera sin descargar ni generar nada: es la misma hoja A4
     de documento(), encogida para que entre completa en la ventana. Sirve para
     la cotización y para la orden de producción (ver abrirVisor).
     El visor cuelga del <body> (como #print-root) y no de la vista, para que
     no se lo lleve por delante el repintado del tablero de Proceso. */

  var visorEl = null;

  // Encaja la hoja entera dentro del visor: la encoge lo justo para que la
  // cotización se vea completa de una vez, sin scroll, y sin pasarse de tamaño
  // en pantallas grandes (nunca crece por encima del tamaño real).
  function ajustarVisor() {
    if (!visorEl) return;
    var lienzo = visorEl.querySelector('.visor__lienzo');
    var marco = visorEl.querySelector('.visor__marco');
    var hoja = visorEl.querySelector('.hoja');
    if (!lienzo || !marco || !hoja || !marco.firstElementChild) return;

    var ancho = hoja.offsetWidth;    // 210mm tal cual
    var alto = hoja.offsetHeight;    // 297mm tal cual

    // Hueco disponible para la hoja: el relleno del lienzo por los lados y, a lo
    // alto, lo que dejan el encabezado y el pie del visor (≤ 92% de la ventana).
    function hueco(anchoLienzo) {
      var cabecera = visorEl.querySelector('.visor__head');
      var pie = visorEl.querySelector('.visor__pie');
      return {
        ancho: anchoLienzo - 26,
        alto: window.innerHeight * 0.92 - 30 -
          (cabecera ? cabecera.offsetHeight : 0) - (pie ? pie.offsetHeight : 0)
      };
    }

    // El factor que hace que la hoja entre entera (ni agranda ni se sale).
    function escalaPara(h) {
      var e = Math.min(1, h.ancho / ancho, h.alto / alto);
      return isFinite(e) && e > 0 ? e : 1;
    }

    // Primera vuelta con el visor a su ancho máximo, y luego se estrecha hasta
    // el ancho de la hoja: en el escritorio manda el alto, así que sin esto
    // quedarían dos franjas vacías a los lados.
    visorEl.style.width = '';
    var escala = escalaPara(hueco(lienzo.clientWidth));
    visorEl.style.width = (Math.round(ancho * escala) + 26) + 'px';
    // Segunda vuelta: con el visor ya estrecho, el encabezado y el pie pueden
    // haber crecido; el ancho no cambia más, así que no hay bucle.
    escala = escalaPara(hueco(lienzo.clientWidth));

    marco.style.width = Math.round(ancho * escala) + 'px';
    marco.style.height = Math.round(alto * escala) + 'px';
    marco.firstElementChild.style.transform = 'scale(' + escala + ')';
  }

  function cerrarVisor() {
    if (!visorEl) return;
    var el = visorEl;
    visorEl = null;                       // antes de cerrar: 'close' vuelve aquí
    if (el.open) el.close();
    el.remove();
    window.removeEventListener('resize', ajustarVisor);
  }

  // Abre el visor con una hoja ya dibujada: el mismo diálogo sirve para la
  // cotización y para la orden de producción.
  //   opciones = { meta, html, titulo, etiqueta, imprimir }
  // `imprimir` es lo que hace el botón «Descargar PDF» del visor.
  // Devuelve false si el navegador no tiene <dialog> (ahí se imprime directo).
  function abrirVisor(opciones) {
    var o = opciones || {};
    var meta = o.meta || {};

    // Navegadores sin <dialog>: se cae al diálogo de impresión de siempre.
    if (typeof document.createElement('dialog').showModal !== 'function') {
      return o.imprimir ? !!o.imprimir() : false;
    }

    cerrarVisor();

    var dlg = document.createElement('dialog');
    visorEl = dlg;
    dlg.className = 'visor';
    dlg.setAttribute('aria-label', o.etiqueta || o.titulo || 'Hoja');
    dlg.innerHTML =
      '<header class="visor__head">' +
        '<div>' +
          '<h2 class="visor__title">' + Utils.escapeHtml(o.titulo || '') + '</h2>' +
          '<p class="visor__meta">' +
            Utils.escapeHtml(meta.cliente || 'Sin cliente') + ' \u00b7 ' +
            Utils.escapeHtml(fechaTexto(meta.fecha)) +
          '</p>' +
        '</div>' +
        '<button class="icon-btn visor__cerrar" type="button" data-cerrar ' +
          'title="Cerrar" aria-label="Cerrar">\u2715</button>' +
      '</header>' +
      '<div class="visor__lienzo">' +
        '<div class="visor__marco"><div class="visor__hoja">' +
          (o.html || '') +
        '</div></div>' +
      '</div>' +
      '<footer class="visor__pie">' +
        '<p class="visor__pista">Gira el teléfono o pellizca para leerlo más grande.</p>' +
        '<button class="btn btn--ghost" type="button" data-cerrar>Cerrar</button>' +
        '<button class="btn btn--primary" type="button" data-imprimir>' +
          '\ud83d\udda8\ufe0f Descargar PDF</button>' +
      '</footer>';

    dlg.addEventListener('click', function (e) {
      if (e.target.closest('[data-cerrar]')) { cerrarVisor(); return; }
      if (e.target.closest('[data-imprimir]')) { if (o.imprimir) o.imprimir(); return; }
      if (e.target === dlg) cerrarVisor();   // clic en el fondo oscuro
    });
    // Esc y el cierre del navegador pasan por aquí: se limpia el visor del DOM.
    dlg.addEventListener('close', cerrarVisor);

    document.body.appendChild(dlg);
    dlg.showModal();
    ajustarVisor();
    window.addEventListener('resize', ajustarVisor);
    return true;
  }

  // Abre el visor con la cotización que se le pase; sin argumentos, la del
  // carrito. Devuelve false si no hay nada que enseñar.
  function ver(fuente) {
    var origen = fuente || {};
    var items = origen.items || window.Cart.getItems();
    var meta = origen.meta || window.Cart.getMeta();
    if (!items.length) return false;

    return abrirVisor({
      meta: meta,
      etiqueta: 'Cotización ' + folioTexto(meta.folio),
      titulo: 'Cotización ' + folioTexto(meta.folio),
      html: documento({ meta: meta, items: items }, 'cotizacion-hoja-ver'),
      imprimir: function () { return imprimir({ meta: meta, items: items }); }
    });
  }

  // Lo mismo, con la orden de producción de una tarjeta del tablero: qué hay
  // que fabricar, ya agrupado (las cuentas las hace window.PO).
  function verPO(fuente) {
    var origen = fuente || {};
    var items = origen.items || [];
    var meta = origen.meta || {};
    if (!window.PO || !items.length) return false;

    var args = { meta: meta, items: items, etapa: Utils.normalize(origen.etapa) };
    var html = documentoPO(args, 'po-hoja-ver');
    if (!html) return false;

    return abrirVisor({
      meta: meta,
      etiqueta: 'Orden de producción ' + folioTexto(meta.folio),
      titulo: 'Orden de producción ' + folioTexto(meta.folio),
      html: html,
      imprimir: function () { return imprimirPO(args); }
    });
  }


  /* -------------------------- Impresión -------------------------- */

  // Título limpio de la pestaña, para devolverlo tal cual después de imprimir
  // (durante la impresión pasa a ser el nombre sugerido del archivo).
  var tituloBase = document.title;

  // Abre el diálogo de impresión (de ahí se elige "Guardar como PDF").
  // Dibuja la hoja en #print-root, así funciona desde cualquier pestaña (el
  // carrito, el tablero de Proceso) y no depende de la vista previa montada.
  // El nombre sugerido del archivo sale del <title> de la página.
  function imprimir(fuente) {
    var origen = fuente || {};
    var items = origen.items || window.Cart.getItems();
    var meta = origen.meta || window.Cart.getMeta();
    if (!items.length) return false;

    return imprimirHoja(documento({ meta: meta, items: items }, 'cotizacion-hoja-print'),
      nombreArchivo(meta));
  }

  // Nombre sugerido del PDF de la orden de producción: Produccion-0001-Cliente.
  function nombreArchivoPO(metaFuente) {
    var meta = metaFuente || {};
    var partes = ['Produccion', folioTexto(meta.folio).replace(/\D/g, '')];
    var quien = slug(meta.cliente);
    if (quien) partes.push(quien);
    return partes.join('-');
  }

  // La orden de producción se imprime con el mismo motor que la cotización: lo
  // único que cambia es la hoja y el nombre del archivo.
  function imprimirPO(fuente) {
    var origen = fuente || {};
    var meta = origen.meta || {};
    var html = documentoPO({
      meta: meta,
      items: origen.items || [],
      etapa: Utils.normalize(origen.etapa)
    }, 'po-hoja-print');
    if (!html) return false;
    return imprimirHoja(html, nombreArchivoPO(meta));
  }

  // Deja UNA hoja lista en #print-root (body.app-print le dice al CSS que lo
  // único que debe salir en el papel es esa hoja) y abre el diálogo de impresión.
  function imprimirHoja(html, nombre) {
    var raiz = document.getElementById('print-root');
    if (raiz) raiz.innerHTML = html;

    var restaurado = false;

    // Se llama al cerrar el diálogo (afterprint) o, si el navegador no lo emite,
    // con el temporizador de respaldo: deja la app como estaba.
    function restaurar() {
      if (restaurado) return;
      restaurado = true;
      document.title = tituloBase;
      document.body.classList.remove('app-print');
      if (raiz) raiz.innerHTML = '';
      window.removeEventListener('afterprint', restaurar);
    }

    // body.app-print le dice al CSS de impresión que lo único que debe salir en
    // el papel es la hoja de #print-root.
    document.body.classList.add('app-print');
    document.title = nombre;
    window.addEventListener('afterprint', restaurar);
    window.print();
    // Chrome bloquea hasta cerrar el diálogo; Safari no lo hace. Los dos caminos
    // dejan la app limpia, así que se cubren ambos.
    setTimeout(restaurar, 400);
    return true;
  }

  window.PDF = {
    getNegocio: getNegocio,
    documento: documento,
    documentoPO: documentoPO,
    encajarHoja: encajarHoja,
    ver: ver,
    verPO: verPO,
    imprimir: imprimir,
    imprimirPO: imprimirPO,
    nombreArchivo: nombreArchivo,
    nombreArchivoPO: nombreArchivoPO,
    folioTexto: folioTexto,
    fechaTexto: fechaTexto
  };

})();
