/* Finanzas (dentro de Estadísticas): lo que se cobró, lo que se gastó y cómo (efectivo
 * o tarjeta). Se expone como window.Views.finanzas y la pinta la vista de Estadísticas
 * en su lugar (#finanzas-slot).
 *
 *   · Los PAGOS salen del tablero (cada tarjeta trae sus pagos/abonos: ver
 *     Proceso.sanearTarjeta), así que cambiar un pago en la tarjeta rehace esto solo.
 *     Tocar una fila lleva a la tarjeta con sus pagos abiertos (Views.proceso.abrirTarjeta).
 *   · Los GASTOS no son de ninguna cotización: se piden al API (/api/gastos) la primera
 *     vez y se vuelven a pedir después de agregar, cambiar o borrar uno.
 *
 * Los filtros (mes y forma de pago) se aplican a las dos tablas; el resumen de arriba
 * respeta el mes y desglosa siempre por forma. Lo que se esté escribiendo en el
 * formulario de gasto vive en `borrador`: el sondeo del tablero repinta la pantalla
 * cada tanto y así no se pierde. */
(function () {
  'use strict';

  var Utils = window.Utils;
  var Proceso = window.Proceso;

  var TODOS = 'todos';
  var SIN = 'sin';
  var FORMAS = [
    { id: 'efectivo', nombre: 'Efectivo' },
    { id: 'tarjeta', nombre: 'Tarjeta' }
  ];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var slotEl = null;
  var filtroMes = TODOS;
  var filtroForma = TODOS;
  var gastos = null;          // null = todavía no llegan
  var cargando = false;
  var errorGastos = '';
  var borrador = null;        // { id (si se edita), fecha, monto, metodo, nota }
  var alRepintar = null;      // avisa a Estadísticas que hay que volver a pintar

  function escapar(v) { return Utils.escapeHtml(v); }
  function dinero(n) { return Utils.formatMoney(n); }
  function redondo(n) { return Math.round(n * 100) / 100; }

  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function borradorNuevo() { return { id: '', fecha: hoyISO(), monto: '', metodo: 'efectivo', nota: '' }; }

  function etiquetaMes(mes) {
    var m = /^(\d{4})-(\d{2})$/.exec(mes);
    return m ? MESES[Number(m[2]) - 1] + ' ' + m[1] : mes;
  }

  // «25/11/2026» (en el celular, «25/11»: el año se esconde con CSS). Devuelve HTML.
  function fechaCorta(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '<span class="fin-anio">/' + m[1] + '</span>' : escapar(iso || '');
  }

  function nombreForma(id) {
    if (id === 'efectivo') return 'Efectivo';
    if (id === 'tarjeta') return 'Tarjeta';
    return 'Sin especificar';
  }

  var FORMA_CORTA = { efectivo: 'Efec.', tarjeta: 'Tarj.' };
  function formaTemplate(id) {
    return '<span class="fin-forma fin-forma--' + (id || SIN) + '" title="' + escapar(nombreForma(id)) + '">' +
      '<span class="fin-forma__largo">' + escapar(nombreForma(id)) + '</span>' +
      '<span class="fin-forma__corto">' + escapar(FORMA_CORTA[id] || 'Sin esp.') + '</span></span>';
  }

  /* ------------------------------- Datos ------------------------------- */

  function pagosDelTablero() {
    var lista = [];
    (Proceso.getTarjetas() || []).forEach(function (t) {
      (t.pagos || []).forEach(function (p) {
        lista.push({ id: p.id, fecha: p.fecha, monto: p.monto, metodo: p.metodo || '', nota: p.nota,
          tarjetaId: t.id, folio: t.folio, cliente: t.cliente });
      });
    });
    return lista.sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
  }

  function cargarGastos() {
    if (cargando || !window.Api) return;
    cargando = true;
    window.Api.gastos().then(function (datos) {
      gastos = (datos && datos.gastos) || [];
      errorGastos = '';
    }, function (error) {
      errorGastos = error.message || 'No se pudieron leer los gastos.';
      if (!gastos) gastos = [];
    }).then(function () {
      cargando = false;
      if (alRepintar) alRepintar();
    });
  }

  function delMes(fecha) { return filtroMes === TODOS || String(fecha).slice(0, 7) === filtroMes; }
  function deLaForma(metodo) {
    return filtroForma === TODOS || (filtroForma === SIN ? !metodo : metodo === filtroForma);
  }

  function sumar(lista, forma) {
    return redondo(lista.reduce(function (s, x) {
      return s + (forma === undefined || (x.metodo || '') === forma ? x.monto : 0);
    }, 0));
  }

  // Lo que hay que pintar, ya filtrado. Entra en la firma de Estadísticas: si no cambió
  // nada, no se repinta.
  function leer() {
    var pagos = pagosDelTablero();
    var gs = gastos || [];
    var meses = {};
    pagos.forEach(function (p) { meses[String(p.fecha).slice(0, 7)] = true; });
    gs.forEach(function (g) { meses[String(g.fecha).slice(0, 7)] = true; });
    var listaMeses = Object.keys(meses).filter(Boolean).sort().reverse();
    if (filtroMes !== TODOS && listaMeses.indexOf(filtroMes) < 0) filtroMes = TODOS;

    var pagosMes = pagos.filter(function (p) { return delMes(p.fecha); });
    var gastosMes = gs.filter(function (g) { return delMes(g.fecha); });
    var cobrado = { total: sumar(pagosMes), efectivo: sumar(pagosMes, 'efectivo'),
      tarjeta: sumar(pagosMes, 'tarjeta'), sin: sumar(pagosMes, '') };
    var gastado = { total: sumar(gastosMes), efectivo: sumar(gastosMes, 'efectivo'), tarjeta: sumar(gastosMes, 'tarjeta') };
    return {
      meses: listaMeses,
      mes: filtroMes,
      forma: filtroForma,
      cobrado: cobrado,
      gastado: gastado,
      pagos: pagosMes.filter(function (p) { return deLaForma(p.metodo); }),
      gastos: gastosMes.filter(function (g) { return deLaForma(g.metodo); }),
      cargando: gastos === null,
      error: errorGastos,
      borrador: borrador
    };
  }

  /* ----------------------------- Plantillas ----------------------------- */

  function cifra(etiqueta, valor, clase, sub) {
    return '<div class="estat-cifra' + (clase ? ' ' + clase : '') + '">' +
      '<span class="estat-cifra__label">' + escapar(etiqueta) + '</span>' +
      '<b class="estat-cifra__valor">' + escapar(valor) + '</b>' +
      (sub ? '<span class="fin-cifra__sub">' + sub + '</span>' : '') +
    '</div>';
  }

  function filtrosTemplate(d) {
    var meses = '<option value="' + TODOS + '"' + (d.mes === TODOS ? ' selected' : '') + '>Todos los meses</option>' +
      d.meses.map(function (m) {
        return '<option value="' + escapar(m) + '"' + (m === d.mes ? ' selected' : '') + '>' + escapar(etiquetaMes(m)) + '</option>';
      }).join('');
    var formas = [{ id: TODOS, nombre: 'Todas' }].concat(FORMAS).concat([{ id: SIN, nombre: 'Sin especificar' }])
      .map(function (f) {
        return '<option value="' + f.id + '"' + (f.id === d.forma ? ' selected' : '') + '>' + escapar(f.nombre) + '</option>';
      }).join('');
    return '<div class="fin-filtros">' +
      '<label class="field"><span class="field__label">Mes</span><select class="field__input" data-fin-mes>' + meses + '</select></label>' +
      '<label class="field"><span class="field__label">Forma de pago</span><select class="field__input" data-fin-forma>' + formas + '</select></label>' +
    '</div>';
  }

  function resumenTemplate(d) {
    var c = d.cobrado, g = d.gastado;
    var balance = redondo(c.total - g.total);
    return '<div class="estat-cifras fin-cifras">' +
      cifra('Ventas cobradas', dinero(c.total), 'estat-cifra--plata fin-cifra--ventas',
        'Efectivo ' + dinero(c.efectivo) + ' · Tarjeta ' + dinero(c.tarjeta) +
        (c.sin ? ' · <span class="fin-sin">Sin especificar ' + dinero(c.sin) + '</span>' : '')) +
      cifra('Gastos', dinero(g.total), 'fin-cifra--gasto',
        'Efectivo ' + dinero(g.efectivo) + ' · Tarjeta ' + dinero(g.tarjeta)) +
      cifra('Queda', dinero(balance), balance < 0 ? 'fin-cifra--negativo' : 'fin-cifra--balance', 'Ventas − gastos') +
      cifra('Efectivo (caja)', dinero(redondo(c.efectivo - g.efectivo)), 'fin-cifra--efectivo', 'Cobrado − gastado en efectivo') +
      cifra('Tarjeta', dinero(redondo(c.tarjeta - g.tarjeta)), 'fin-cifra--tarjeta', 'Cobrado − gastado con tarjeta') +
    '</div>';
  }

  function pagosTemplate(d) {
    if (!d.pagos.length) {
      return '<p class="estat-none">No hay pagos con este filtro. Se registran en la tarjeta: al tildar ' +
        '<b>Pagado</b> o con el botón 💵 (abonos).</p>';
    }
    return '<div class="estat-tabla-wrap"><table class="estat-tabla fin-tabla">' +
      '<thead><tr><th>#</th><th>Cliente</th><th class="estat-tabla__plata">Monto</th><th>Fecha</th><th>Forma</th></tr></thead>' +
      '<tbody>' + d.pagos.map(function (p) {
        return '<tr class="fin-fila" tabindex="0" role="button" data-ir="' + escapar(p.tarjetaId) + '" ' +
            'title="Abrir la cotización y sus pagos">' +
          '<td class="fin-folio">' + escapar(window.PDF ? PDF.folioTexto(p.folio) : p.folio) + '</td>' +
          '<td class="fin-cliente">' + escapar(p.cliente || 'Sin cliente') +
            (p.nota ? '<span class="fin-nota">' + escapar(p.nota) + '</span>' : '') + '</td>' +
          '<td class="estat-tabla__plata">' + dinero(p.monto) + '</td>' +
          '<td>' + fechaCorta(p.fecha) + '</td>' +
          '<td>' + formaTemplate(p.metodo) + '</td>' +
        '</tr>';
      }).join('') + '</tbody>' +
      '<tfoot><tr><td colspan="2">Total (' + d.pagos.length + ')</td><td class="estat-tabla__plata fin-total">' +
        dinero(sumar(d.pagos)) + '</td><td></td><td></td></tr></tfoot>' +
    '</table></div>';
  }

  function gastoFormTemplate(b) {
    var editando = !!b.id;
    return '<form class="fin-gasto-form" data-fin-gasto novalidate>' +
      '<div class="fin-gasto-campos">' +
        '<label class="field"><span class="field__label">Fecha</span>' +
          '<input class="field__input" type="date" name="fecha" value="' + escapar(b.fecha) + '"></label>' +
        '<label class="field"><span class="field__label">Monto ($)</span>' +
          '<input class="field__input" type="number" min="0.01" step="0.01" inputmode="decimal" name="monto" value="' + escapar(b.monto) + '" placeholder="0.00"></label>' +
        '<label class="field"><span class="field__label">Forma</span><select class="field__input" name="metodo">' +
          FORMAS.map(function (f) {
            return '<option value="' + f.id + '"' + (f.id === b.metodo ? ' selected' : '') + '>' + f.nombre + '</option>';
          }).join('') + '</select></label>' +
        '<label class="field fin-gasto-nota"><span class="field__label">Nota (qué fue)</span>' +
          '<input class="field__input" type="text" maxlength="200" name="nota" value="' + escapar(b.nota) + '" placeholder="Ej. Filamento PLA negro 1 kg"></label>' +
      '</div>' +
      '<div class="fin-gasto-acciones">' +
        (editando ? '<button class="btn" type="button" data-fin-cancelar>Cancelar</button>' : '') +
        '<button class="btn btn--primary" type="submit">' + (editando ? 'Guardar cambios' : 'Agregar gasto') + '</button>' +
      '</div>' +
    '</form>';
  }

  function gastosTemplate(d) {
    var tabla;
    if (d.cargando) tabla = '<p class="estat-none">Cargando gastos…</p>';
    else if (!d.gastos.length) tabla = '<p class="estat-none">No hay gastos con este filtro.</p>';
    else {
      tabla = '<div class="estat-tabla-wrap"><table class="estat-tabla fin-tabla">' +
        '<thead><tr><th>Fecha</th><th>Nota</th><th>Forma</th><th class="estat-tabla__plata">Monto</th><th></th></tr></thead>' +
        '<tbody>' + d.gastos.map(function (g) {
          return '<tr' + (d.borrador && d.borrador.id === g.id ? ' class="fin-fila--editando"' : '') + '>' +
            '<td>' + fechaCorta(g.fecha) + '</td>' +
            '<td class="fin-cliente">' + escapar(g.nota || '—') + '</td>' +
            '<td>' + formaTemplate(g.metodo) + '</td>' +
            '<td class="estat-tabla__plata">' + dinero(g.monto) + '</td>' +
            '<td class="fin-acciones"><span class="fin-acciones__btns">' +
              '<button class="icon-btn" type="button" data-fin-editar="' + escapar(g.id) + '" title="Editar" aria-label="Editar gasto">✏️</button>' +
              '<button class="icon-btn" type="button" data-fin-borrar="' + escapar(g.id) + '" title="Borrar" aria-label="Borrar gasto">🗑</button>' +
            '</span></td>' +
          '</tr>';
        }).join('') + '</tbody>' +
        '<tfoot><tr><td colspan="3">Total (' + d.gastos.length + ')</td><td class="estat-tabla__plata">' +
          dinero(sumar(d.gastos)) + '</td><td></td></tr></tfoot>' +
      '</table></div>';
    }
    return (d.error ? '<p class="alert alert--warn">' + escapar(d.error) + '</p>' : '') +
      gastoFormTemplate(d.borrador || borradorNuevo()) + tabla;
  }

  // Cada parte va en su caja: franja de título (con su color) y el contenido abajo.
  function area(clase, titulo, cuerpo) {
    return '<div class="fin-area fin-area--' + clase + '">' +
      '<h4 class="fin-area__titulo">' + titulo + '</h4>' +
      '<div class="fin-area__cuerpo">' + cuerpo + '</div>' +
    '</div>';
  }

  function template(d) {
    return '<section class="panel" id="estat-finanzas">' +
      '<h3 class="panel__title">Finanzas</h3>' +
      '<p class="panel__hint">Lo cobrado (cada pago y abono, por la fecha en que se cobró) y los gastos. ' +
        'Los filtros se aplican a las dos tablas; el resumen respeta el mes.</p>' +
      area('filtros', '🔎 Filtros', filtrosTemplate(d)) +
      area('resumen', '📊 Resumen' + (d.mes === TODOS ? '' : ' · ' + escapar(etiquetaMes(d.mes))), resumenTemplate(d)) +
      area('pagos', '💵 Pagos registrados', pagosTemplate(d)) +
      area('gastos', '🧾 Gastos', gastosTemplate(d)) +
    '</section>';
  }

  /* ---------------------------- Interacciones ---------------------------- */

  function leerFormulario(form) {
    return {
      id: borrador && borrador.id || '',
      fecha: form.elements.fecha.value,
      monto: form.elements.monto.value,
      metodo: form.elements.metodo.value,
      nota: form.elements.nota.value
    };
  }

  function guardarGasto(form) {
    var b = leerFormulario(form);
    var monto = Number(b.monto);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) { window.App.toast('Elige la fecha del gasto', 'error'); return; }
    if (!isFinite(monto) || monto <= 0) { window.App.toast('Escribe el monto del gasto', 'error'); return; }
    var datos = { fecha: b.fecha, monto: monto, metodo: b.metodo, nota: b.nota };
    var boton = form.querySelector('[type=submit]');
    boton.disabled = true;
    var llamada = b.id ? window.Api.editarGasto(b.id, datos) : window.Api.crearGasto(datos);
    llamada.then(function (r) {
      var g = r && r.gasto;
      if (g) {
        gastos = (gastos || []).filter(function (x) { return x.id !== g.id; }).concat([g])
          .sort(function (a, x) { return a.fecha < x.fecha ? 1 : a.fecha > x.fecha ? -1 : 0; });
      }
      window.App.toast(b.id ? 'Gasto actualizado' : 'Gasto agregado', 'success');
      borrador = null;
      if (alRepintar) alRepintar();
    }, function (error) {
      boton.disabled = false;
      window.App.toast('No se pudo guardar el gasto: ' + error.message, 'error');
    });
  }

  function borrarGasto(id) {
    if (!window.confirm('¿Borrar este gasto?')) return;
    window.Api.borrarGasto(id).then(function () {
      gastos = (gastos || []).filter(function (g) { return g.id !== id; });
      if (borrador && borrador.id === id) borrador = null;
      window.App.toast('Gasto borrado', 'success');
      if (alRepintar) alRepintar();
    }, function (error) {
      window.App.toast('No se pudo borrar el gasto: ' + error.message, 'error');
    });
  }

  function enganchar(el) {
    el.addEventListener('change', function (e) {
      if (e.target.matches('[data-fin-mes]')) { filtroMes = e.target.value; if (alRepintar) alRepintar(); return; }
      if (e.target.matches('[data-fin-forma]')) { filtroForma = e.target.value; if (alRepintar) alRepintar(); }
    });
    // Lo que se escribe en el formulario de gasto se guarda en el borrador.
    el.addEventListener('input', function (e) {
      var form = e.target.closest('[data-fin-gasto]');
      if (form) borrador = leerFormulario(form);
    });
    el.addEventListener('submit', function (e) {
      var form = e.target.closest('[data-fin-gasto]');
      if (!form) return;
      e.preventDefault();
      guardarGasto(form);
    });
    el.addEventListener('click', function (e) {
      var ir = e.target.closest('[data-ir]');
      if (ir) { window.Views.proceso.abrirTarjeta(ir.getAttribute('data-ir')); return; }
      var editar = e.target.closest('[data-fin-editar]');
      if (editar) {
        var g = (gastos || []).filter(function (x) { return x.id === editar.getAttribute('data-fin-editar'); })[0];
        if (!g) return;
        borrador = { id: g.id, fecha: g.fecha, monto: String(g.monto), metodo: g.metodo, nota: g.nota };
        if (alRepintar) alRepintar();
        var form = slotEl && slotEl.querySelector('[data-fin-gasto]');
        if (form) { form.scrollIntoView({ block: 'center' }); form.elements.monto.focus(); }
        return;
      }
      var borrar = e.target.closest('[data-fin-borrar]');
      if (borrar) { borrarGasto(borrar.getAttribute('data-fin-borrar')); return; }
      if (e.target.closest('[data-fin-cancelar]')) { borrador = null; if (alRepintar) alRepintar(); }
    });
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var ir = e.target.closest && e.target.closest('[data-ir]');
      if (!ir) return;
      e.preventDefault();
      window.Views.proceso.abrirTarjeta(ir.getAttribute('data-ir'));
    });
  }

  // Estadísticas llama a firma() para saber si hay que repintar, y a render(slot) al pintar.
  function firma() {
    if (gastos === null) cargarGastos();
    var d = leer();
    // Lo que se va escribiendo no cuenta (si no, el sondeo repintaría a media palabra):
    // sólo qué gasto se está editando.
    d.borrador = borrador && borrador.id ? borrador.id : '';
    return JSON.stringify(d);
  }

  function render(slot, repintar) {
    slotEl = slot;
    alRepintar = repintar || alRepintar;
    if (gastos === null) cargarGastos();
    slot.innerHTML = template(leer());
    enganchar(slot);
  }

  window.Views = window.Views || {};
  window.Views.finanzas = { render: render, firma: firma };
})();
