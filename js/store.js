/* Configuración compartida del cotizador (colores en stock + precios).
 *
 * Vive en Postgres y se lee/escribe por el API (/api/config): así los colores y
 * los precios son los mismos en todo el taller, en cualquier navegador.
 * La app arranca los datos con Store.init() (lo que trae el bootstrap) y de ahí
 * en adelante cada cambio se pinta al instante en memoria y se manda al
 * servidor por atrás. Si el guardado falla, se vuelve a lo último confirmado
 * por el servidor y se avisa: nunca queda en pantalla algo que no se guardó.
 *
 * Se expone como window.Store */
(function () {
  'use strict';

  // Sólo se usan cuando la base todavía no tiene configuración (instalación
  // nueva): se siembran una vez y después manda siempre lo que hay en Neon.
  var DEFAULT_CONFIG = {
    colores: [
      { id: 'color-negro', nombre: 'Negro', hex: '#111111' },
      { id: 'color-blanco', nombre: 'Blanco', hex: '#FFFFFF' },
      { id: 'color-rojo', nombre: 'Rojo', hex: '#D32F2F' }
    ],
    precios: {
      nombre: 60,
      nombreApellido: 100
    }
  };

  var config = clone(DEFAULT_CONFIG);
  var confirmada = clone(DEFAULT_CONFIG);   // último estado que el servidor aceptó
  var listeners = [];
  var cola = Promise.resolve();             // guardados en fila: uno por vez

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // Sanea lo que llega (de la base o de la memoria) y completa lo que falte.
  function sanitize(parsed) {
    parsed = parsed || {};
    var out = clone(DEFAULT_CONFIG);

    if (Array.isArray(parsed.colores)) {
      out.colores = parsed.colores
        .filter(function (c) { return c && typeof c.hex === 'string'; })
        .map(function (c) {
          return {
            id: c.id || window.Utils.uid(),
            nombre: window.Utils.normalize(c.nombre) || 'Sin nombre',
            hex: c.hex
          };
        });
    }

    if (parsed.precios) {
      out.precios.nombre = window.Utils.parseNumber(parsed.precios.nombre, DEFAULT_CONFIG.precios.nombre);
      out.precios.nombreApellido = window.Utils.parseNumber(parsed.precios.nombreApellido, DEFAULT_CONFIG.precios.nombreApellido);
    }

    return out;
  }

  function notify() {
    listeners.forEach(function (fn) { fn(getConfig()); });
  }


  /* --------------------------- Enlace con el API --------------------------- */

  // Manda la config y adopta la que devuelve el servidor (él vuelve a sanear).
  // Los guardados van en fila para que dos cambios seguidos no se pisen.
  function guardar() {
    var enviado = clone(config);
    cola = cola.then(function () {
      return window.Api.guardarConfig(enviado);
    }).then(function (datos) {
      var aceptada = sanitize((datos && datos.config) || enviado);
      confirmada = aceptada;
      if (JSON.stringify(aceptada) !== JSON.stringify(config)) {
        config = clone(aceptada);
        notify();
      }
      return aceptada;
    }, function (error) {
      // No se guardó: se vuelve a lo confirmado y se avisa, sin romper la app.
      config = clone(confirmada);
      notify();
      window.App.toast('No se guardó el cambio: ' + error.message, 'error');
      return null;
    });
    return cola;
  }

  // Carga la config que vino del bootstrap. Si la base todavía no tiene ninguna
  // (instalación nueva, sin fila), se siembran los valores por defecto.
  function init(datos, actualizada) {
    config = sanitize(datos);
    if (!actualizada && !config.colores.length &&
        !config.precios.nombre && !config.precios.nombreApellido) {
      config = clone(DEFAULT_CONFIG);
      guardar();
    }
    confirmada = clone(config);
    notify();
  }

  // Promesa del guardado en curso (o del último): la usa quien quiera esperar
  // a que los datos estén en Neon.
  function pendiente() { return cola; }

  /* ---------------------------- Lectura ---------------------------- */

  function getConfig() {
    return clone(config);
  }

  function findColor(id) {
    for (var i = 0; i < config.colores.length; i++) {
      if (config.colores[i].id === id) return clone(config.colores[i]);
    }
    return null;
  }


  /* --------------------------- Escritura --------------------------- */

  // Agrega un color al stock. Devuelve { ok, error }.
  function addColor(nombre, hex) {
    nombre = window.Utils.normalize(nombre);
    if (!nombre) return { ok: false, error: 'Escribe un nombre para el color.' };
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return { ok: false, error: 'Selecciona un color válido.' };

    var duplicado = config.colores.some(function (c) {
      return c.nombre.toLowerCase() === nombre.toLowerCase();
    });
    if (duplicado) return { ok: false, error: 'Ya existe un color con ese nombre.' };

    config.colores.push({ id: window.Utils.uid(), nombre: nombre, hex: hex });
    notify();
    guardar();
    return { ok: true };
  }

  // Quita un color del stock. Devuelve { ok, error }.
  function removeColor(id) {
    var antes = config.colores.length;
    config.colores = config.colores.filter(function (c) { return c.id !== id; });
    if (config.colores.length === antes) return { ok: false, error: 'Color no encontrado.' };
    notify();
    guardar();
    return { ok: true };
  }

  function setPrecios(precios) {
    config.precios.nombre = window.Utils.parseNumber(precios.nombre, config.precios.nombre);
    config.precios.nombreApellido = window.Utils.parseNumber(precios.nombreApellido, config.precios.nombreApellido);
    notify();
    guardar();
    return { ok: true };
  }

  function resetDefaults() {
    config = clone(DEFAULT_CONFIG);
    notify();
    guardar();
  }

  // Permite que las vistas reaccionen a cambios de la configuración.
  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  window.Store = {
    init: init,
    pendiente: pendiente,
    getConfig: getConfig,
    findColor: findColor,
    addColor: addColor,
    removeColor: removeColor,
    setPrecios: setPrecios,
    resetDefaults: resetDefaults,
    subscribe: subscribe
  };
})();
