/* Vista de Proceso: tablero Kanban de las cotizaciones enviadas.
 * Ruta: #/proceso. Se expone como window.Views.proceso
 *
 * Las tarjetas cambian de columna (Cotización -> Trabajo -> Realizado ->
 * Entregado) con los botones de la propia tarjeta: «← Atrás» y «Adelante →», que
 * además llevan el nombre de la columna a la que van. No hay arrastrar y soltar:
 * con el dedo el gesto se confundía con el scroll de la página.
 * Cada tarjeta trae el tilde de «Pagado» al lado del importe: se tilda solo al
 * entrar a «Entregado» (lo hace el servidor) y se puede destildar a mano.
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

  /* ---------------------------- Plantillas ---------------------------- */

  function headTemplate() {
    return '' +
      '<div class="page__head">' +
        '<h2 class="page__title">Proceso</h2>' +
        '<p class="page__subtitle">Cada tarjeta es una cotización enviada. Para pasarla a la ' +
          'columna siguiente pulsa <b>Adelante &rarr;</b>, y para devolverla <b>&larr; Atrás</b>: ' +
          'los botones de la tarjeta dicen a qué columna va cada uno.</p>' +
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

  /* ------------------ Lo que hay que fabricar, en corto ------------------
     Las mismas tandas de la orden de producción (las cuentas las hace
     window.PO), pero dentro de la tarjeta: para saber qué imprimir sin abrir
     la hoja. Van en el idioma del taller —cantidad, colores y qué letras
     lleva cada tanda— y con la misma agrupación que la PO: las bases por color
     y acabado, y las teclas con su letra y en ese orden. */

  // «● Café» con su nombre: el color como se pide al proveedor.
  function colorTexto(etiqueta, nombre, hex) {
    return '<span class="meta-tag">' + (etiqueta ? Utils.escapeHtml(etiqueta) + ' ' : '') +
      '<span class="dot" style="background:' + Utils.escapeHtml(hex) + '"></span>' +
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

  function loteGrupoTemplate(titulo, filas, nota) {
    if (!filas.length) return '';
    return '' +
      '<p class="t-lotes__sec">' + Utils.escapeHtml(titulo) + '</p>' +
      (nota ? '<p class="t-lotes__nota">' + Utils.escapeHtml(nota) + '</p>' : '') +
      '<ul class="t-lote-lista">' + filas.join('') + '</ul>';
  }

  // El desglose del taller: las secciones de la PO que tengan algo (bases del
  // clicker, teclas con su letra, llaveros y otros productos) y, al final, el
  // resumen de piezas. Sin nada que fabricar (o en la primera columna, ver
  // poDe) no se pinta nada.
  function lotesTemplate(po) {
    if (!po) return '';

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
        'Todas las del mismo color y acabado se imprimen juntas.') +
      loteGrupoTemplate('Teclas con su letra (' + po.totales.teclas + ')', teclas,
        'La tecla y la letra de arriba van juntas, en ese orden.') +
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

  function tarjetaTemplate(t) {
    var indice = Proceso.indiceColumna(t.columna);
    var po = poDe(t);
    // El botón de ensamble sólo aparece en «Realizado»: es la receta de armado
    // (letra por letra) y se mira con el trabajo ya terminado (ventana aparte,
    // ver abrirEnsamble). Se calcula acá para saber si la cotización tiene
    // clickers con receta; el contenido de la ventana se arma al abrirla.
    var recetas = t.columna === 'realizado' && PO && PO.ensamble ? PO.ensamble(t.items) : [];

    return '' +
      '<article class="tarjeta' +
        (t.columna === 'realizado' ? ' tarjeta--realizado' : '') +
        (t.columna === 'entregado' ? ' tarjeta--entregado' : '') +
        (t.pagado ? ' tarjeta--pagado' : '') + '"' +
        ' data-id="' + Utils.escapeHtml(t.id) + '" tabindex="0">' +
        '<div class="tarjeta__top">' +
          '<span class="tarjeta__folio">' + Utils.escapeHtml(PDF.folioTexto(t.folio)) + '</span>' +
          '<span class="tarjeta__total">' + Utils.formatMoney(t.total) + '</span>' +
        '</div>' +
        pagadoTemplate(t) +
        '<p class="tarjeta__cliente">' +
          (t.cliente
            ? Utils.escapeHtml(t.cliente)
            : '<span class="tarjeta__sin-cliente">Sin cliente</span>') +
        '</p>' +
        '<p class="tarjeta__meta">' +
          Utils.escapeHtml(PDF.fechaTexto(t.fecha)) + ' \u00b7 ' +
          t.unidades + (t.unidades === 1 ? ' pieza' : ' piezas') + ' \u00b7 ' +
          t.items.length + (t.items.length === 1 ? ' l\u00ednea' : ' l\u00edneas') +
        '</p>' +
        '<p class="tarjeta__resumen">' + Utils.escapeHtml(resumenProductos(t.items)) + '</p>' +
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
            '<button class="btn-ver" type="button" data-ver ' +
              'title="Ver la cotizaci\u00f3n completa, sin descargar nada" ' +
              'aria-label="Ver la cotizaci\u00f3n completa">' +
              '<span aria-hidden="true">\ud83d\udc41</span>Ver</button>' +
            '<button class="icon-btn icon-btn--mini" type="button" data-pdf ' +
              'title="Descargar o imprimir el PDF" aria-label="Descargar o imprimir el PDF">\ud83d\udda8</button>' +
            '<button class="icon-btn icon-btn--mini icon-btn--mini-danger" type="button" data-quitar ' +
              'title="Quitar del tablero" aria-label="Quitar del tablero">\u2715</button>' +
          '</span>' +
        '</div>' +
        '<details class="tarjeta__detalle"' + (abiertas[t.id] ? ' open' : '') + '>' +
          '<summary>Detalle para fabricar</summary>' +
          '<ul class="t-lineas">' + lineasTemplate(t.items) + '</ul>' +
          lotesTemplate(po) +
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
      '<section class="kanban__col" data-col="' + col.id + '">' +
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

    rootEl.innerHTML =
      '<div class="page">' +
        headTemplate() +
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

  // Listeners delegados sobre el contenedor: no hay que reengancharlos cada vez
  // que se repinta ni al volver a entrar a la ruta.
  function bind() {
    if (boundEl === rootEl) return;
    boundEl = rootEl;

    rootEl.addEventListener('click', function (e) {
      var tarjetaEl = e.target.closest('.tarjeta');
      if (!tarjetaEl) return;
      var id = tarjetaEl.getAttribute('data-id');

      var paso = e.target.closest('[data-mover]');
      if (paso) {
        moverPaso(id, paso.getAttribute('data-mover') === 'siguiente' ? 1 : -1);
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

      // Reimprime con los datos congelados de la tarjeta: no toca el carrito.
      if (e.target.closest('[data-pdf]')) {
        var t = Proceso.getTarjeta(id);
        if (!t) return;
        PDF.imprimir({ meta: t, items: t.items });
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

    // El tilde de «Pagado»: se pinta al instante y se manda al servidor por atrás
    // (Proceso.cambiarPagado; si falla, el tablero vuelve atrás y avisa).
    rootEl.addEventListener('change', function (e) {
      if (!e.target || typeof e.target.closest !== 'function') return;
      var casilla = e.target.closest('[data-pagado]');
      if (!casilla) return;
      var tarjetaEl = casilla.closest('.tarjeta');
      if (!tarjetaEl) return;
      Proceso.cambiarPagado(tarjetaEl.getAttribute('data-id'), casilla.checked);
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
  // desde el carrito) se repinta, esté o no esta vista montada.
  Proceso.subscribe(function () {
    if (rootEl && rootEl.querySelector('#kanban')) render();
  });

  window.Views = window.Views || {};
  window.Views.proceso = { render: render };
})();
