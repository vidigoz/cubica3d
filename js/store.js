/* Configuración persistente del cotizador (colores en stock + precios).
 * Se guarda en localStorage. Se expone como window.Store */
(function () {
  'use strict';

  var STORAGE_KEY = 'cotizador.config.v1';

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

  var config = load();

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Lee la config guardada y la sanea; si algo falla, usa los valores por defecto.
  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(DEFAULT_CONFIG);
      return sanitize(JSON.parse(raw));
    } catch (e) {
      return clone(DEFAULT_CONFIG);
    }
  }

  function sanitize(parsed) {
    var out = clone(DEFAULT_CONFIG);

    if (parsed && Array.isArray(parsed.colores)) {
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

    if (parsed && parsed.precios) {
      out.precios.nombre = window.Utils.parseNumber(parsed.precios.nombre, DEFAULT_CONFIG.precios.nombre);
      out.precios.nombreApellido = window.Utils.parseNumber(parsed.precios.nombreApellido, DEFAULT_CONFIG.precios.nombreApellido);
    }

    return out;
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      /* Si el almacenamiento no está disponible, se sigue trabajando en memoria. */
    }
  }

  function getConfig() {
    return clone(config);
  }

  function findColor(id) {
    for (var i = 0; i < config.colores.length; i++) {
      if (config.colores[i].id === id) return config.colores[i];
    }
    return null;
  }

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
    persist();
    return { ok: true };
  }

  // Quita un color del stock. Devuelve { ok, error }.
  function removeColor(id) {
    var antes = config.colores.length;
    config.colores = config.colores.filter(function (c) { return c.id !== id; });
    if (config.colores.length === antes) return { ok: false, error: 'Color no encontrado.' };
    persist();
    return { ok: true };
  }

  function setPrecios(precios) {
    config.precios.nombre = window.Utils.parseNumber(precios.nombre, config.precios.nombre);
    config.precios.nombreApellido = window.Utils.parseNumber(precios.nombreApellido, config.precios.nombreApellido);
    persist();
    return { ok: true };
  }

  function resetDefaults() {
    config = clone(DEFAULT_CONFIG);
    persist();
  }

  window.Store = {
    STORAGE_KEY: STORAGE_KEY,
    getConfig: getConfig,
    findColor: findColor,
    addColor: addColor,
    removeColor: removeColor,
    setPrecios: setPrecios,
    resetDefaults: resetDefaults
  };
})();
