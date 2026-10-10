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
        ' <i class="hoja__dot" style="background:' + Utils.escapeHtml(d.hex) + '"></i>' +
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

    var contacto = NEGOCIO.contacto.map(function (c) {
      return '<span>' + Utils.escapeHtml(c) + '</span>';
    }).join('');

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

        '<footer class="hoja__pie">' +
          '<span>' + Utils.escapeHtml(NEGOCIO.pie) + '</span>' +
          '<span class="hoja__contacto">' + contacto + '</span>' +
        '</footer>' +
      '</article>';
  }

  /* -------------------- Visor en pantalla --------------------
     Enseña la cotización completa sin descargar ni generar nada: es la misma
     hoja A4 de documento(), encogida para que entre entera en la ventana.
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

  // Abre el visor con la cotización que se le pase; sin argumentos, la del
  // carrito. Devuelve false si no hay nada que enseñar.
  function ver(fuente) {
    var origen = fuente || {};
    var items = origen.items || window.Cart.getItems();
    var meta = origen.meta || window.Cart.getMeta();
    if (!items.length) return false;

    // Navegadores sin <dialog>: se cae al diálogo de impresión de siempre.
    if (typeof document.createElement('dialog').showModal !== 'function') {
      return imprimir({ meta: meta, items: items });
    }

    cerrarVisor();

    var dlg = document.createElement('dialog');
    visorEl = dlg;
    dlg.className = 'visor';
    dlg.setAttribute('aria-label', 'Cotización ' + folioTexto(meta.folio));
    dlg.innerHTML =
      '<header class="visor__head">' +
        '<div>' +
          '<h2 class="visor__title">Cotización ' + Utils.escapeHtml(folioTexto(meta.folio)) + '</h2>' +
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
          documento({ meta: meta, items: items }, 'cotizacion-hoja-ver') +
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
      if (e.target.closest('[data-imprimir]')) { imprimir({ meta: meta, items: items }); return; }
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

    var raiz = document.getElementById('print-root');
    if (raiz) raiz.innerHTML = documento({ meta: meta, items: items }, 'cotizacion-hoja-print');

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
    document.title = nombreArchivo(meta);
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
    ver: ver,
    imprimir: imprimir,
    nombreArchivo: nombreArchivo,
    folioTexto: folioTexto,
    fechaTexto: fechaTexto
  };
})();
