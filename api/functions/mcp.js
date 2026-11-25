/* Servidor MCP del cotizador Cubica3D (Model Context Protocol), para que agentes de IA
 * consulten el tablero y creen cotizaciones.
 *
 *   POST /mcp     JSON-RPC 2.0 (transporte «Streamable HTTP», sin sesión: cada petición
 *                 se contesta con JSON y se cierra). Métodos: initialize, ping,
 *                 tools/list, tools/call (y las notificaciones, que no llevan respuesta).
 *   GET  /mcp     405: no hay canal de eventos (SSE); todo va por POST.
 *
 * Llaves (variables de entorno, nunca en el código):
 *   MCP_LLAVE_LECTURA    — sólo consulta: catalogo, listar_tarjetas, leer_tarjeta, estadisticas.
 *   MCP_LLAVE_ESCRITURA  — lo anterior + crear_cotizacion.
 * El agente la manda en la cabecera `Authorization: Bearer <llave>` (o `X-Api-Key`). Para
 * los clientes que sólo aceptan una URL también vale `/mcp?llave=<llave>`, aunque así la
 * llave puede quedar en registros: mejor la cabecera cuando se pueda.
 *
 * No tiene lógica propia de base de datos: usa `app.interno` del API (api/functions/api.js),
 * así que crea las tarjetas con las mismas reglas (folio, saneo, bitácora). Los precios NO
 * los manda el agente: se calculan aquí con los de Configuración (salvo la cotización
 * manual, que es precio a mano). Los productos se describen en alto nivel (nombre y
 * colores por nombre) y aquí se arma el desglose exacto que entiende el tablero. */
import { createHash, timingSafeEqual } from "node:crypto";

const VERSIONES = ["2025-06-18", "2025-03-26", "2024-11-05"];
const NOMBRES_COLUMNA = {
  cotizacion: "Cotización", confirmado: "Confirmado", trabajo: "Trabajo",
  fabricado: "Fabricado", realizado: "Realizado", entregado: "Entregado"
};
// Los mismos nombres que js/views/marco.js (FUENTES): el tablero los lee tal cual.
const FUENTES_MARCO = ["Lobster", "Pacifico", "Great Vibes (cursiva fina)", "Kaushan Script", "Cookie",
  "Playball", "Courgette", "Bebas Neue (mayúsculas)"];
const TIPOS = {
  clicker: "Clicker de Nombre", llaveroNombre: "Llavero de Nombre", llaveroLogo: "Llavero de Logo",
  charm: "Charm con cinta", marco: "Marco de Fotos", manual: "Cotización manual"
};
// Un emoji como una sola «letra» (igual que js/utils.js).
const EMOJI = "(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?" +
  "(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)";

/* -------------------------------- Utilidades -------------------------------- */

const texto = (v) => (v == null ? "" : String(v));
const limpio = (v) => texto(v).normalize("NFC").replace(/\s+/g, " ").trim();
const sinAcentos = (v) => texto(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const huella = (v) => createHash("sha256").update(texto(v)).digest();
const redondear = (n) => Math.round(n * 100) / 100;

class ErrorDeHerramienta extends Error {}
const fallar = (mensaje) => { throw new ErrorDeHerramienta(mensaje); };

function mismaLlave(dada, esperada) {
  if (!dada || !esperada) return false;
  return timingSafeEqual(huella(dada), huella(esperada));
}

/* --------------------------- Productos -> líneas --------------------------- */

function buscarColor(colores, pedido, campo) {
  const p = sinAcentos(pedido);
  if (!p) fallar("Falta «" + campo + "».");
  const c = colores.find((x) => sinAcentos(x.nombre) === p || sinAcentos(x.hex) === p);
  if (!c) {
    fallar("El color «" + pedido + "» (" + campo + ") no está en el stock. Colores disponibles: " +
      colores.map((x) => x.nombre).join(", ") + ".");
  }
  return c;
}

function cantidadDe(v) {
  const n = Math.floor(Number(v == null ? 1 : v));
  if (!isFinite(n) || n < 1 || n > 999) fallar("«cantidad» tiene que ser un entero entre 1 y 999.");
  return n;
}

// Las «letras» del clicker: letras, números y emojis (un emoji cuenta como una).
function letrasDeClicker(nombre) {
  const limpioNombre = limpio(nombre);
  if (!limpioNombre) fallar("Falta el nombre del clicker.");
  const letras = [];
  let malo = false;
  limpioNombre.replace(new RegExp("(" + EMOJI + ")|([A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ])|([^])", "gu"), (t, emoji, letra) => {
    if (emoji) letras.push(emoji);
    else if (letra) letras.push(letra.toUpperCase());
    else malo = true;
    return t;
  });
  if (malo) fallar("El nombre del clicker tiene que ser una sola palabra, sólo letras, números y emojis (sin espacios ni signos).");
  if (letras.length > 30) fallar("El nombre del clicker es demasiado largo (máx. 30 letras).");
  return { nombre: limpioNombre, letras };
}

// Las piezas del charm: cada letra, número, signo o emoji del texto (los espacios no cuentan).
function piezasDeCharm(valor) {
  const t = limpio(texto(valor).replace(/·/g, " "));
  if (!t) fallar("Falta el texto del charm.");
  const piezas = [];
  t.replace(new RegExp("(" + EMOJI + ")|[\\uFE0F\\u200D\\u20E3]|(\\s)|([^])", "gu"), (x, emoji, esp, otro) => {
    if (emoji) piezas.push(emoji);
    else if (otro) piezas.push(otro.toUpperCase());
    return x;
  });
  if (!piezas.length) fallar("Falta el texto del charm.");
  if (piezas.length > 40) fallar("El texto del charm no puede pasar de 40 letras, números o signos.");
  return { texto: t, piezas };
}

function acabadoDe(v) {
  const a = sinAcentos(v || "liso");
  if (a.startsWith("corrug")) return "Corrugado";
  if (a.startsWith("lis")) return "Liso";
  fallar("«acabado» tiene que ser «corrugado» o «liso».");
}

// Un producto descrito por el agente -> una línea del tablero, con su precio calculado.
function lineaDe(p, config, indice) {
  const precios = config.precios;
  const colores = config.colores || [];
  const tipo = sinAcentos(p && p.tipo).replace(/[\s-]+/g, "_");
  const donde = "producto " + (indice + 1) + ": ";
  try {
    if (tipo === "clicker") {
      const { nombre, letras } = letrasDeClicker(p.nombre);
      const porLetra = Array.isArray(p.letras) ? p.letras : [];
      const detalles = [];
      letras.forEach((c, i) => {
        const o = porLetra[i] || {};
        const base = buscarColor(colores, o.color_base || p.color_base, "color_base");
        const acabado = acabadoDe(o.acabado || p.acabado);
        const tecla = buscarColor(colores, o.color_tecla || p.color_tecla, "color_tecla");
        const letra = buscarColor(colores, o.color_letra || p.color_letra, "color_letra");
        detalles.push({ label: c + " · Base", nombre: base.nombre + " (" + acabado + ")", hex: base.hex });
        detalles.push({ label: c + " · Tecla", nombre: tecla.nombre, hex: tecla.hex });
        detalles.push({ label: c + " · Letra", nombre: letra.nombre, hex: letra.hex });
      });
      const c = precios.clicer;
      const unidad = redondear((letras.length > c.letrasCorte ? c.porLetraLargo : c.porLetraCorto) * letras.length);
      return { tipo: TIPOS.clicker, titulo: nombre, detalles, precio: unidad, cantidad: cantidadDe(p.cantidad) };
    }
    if (tipo === "llavero_nombre" || tipo === "llavero") {
      const nombre = limpio(p.nombre);
      const apellido = limpio(p.apellido);
      if (!nombre) fallar("Falta el nombre del llavero.");
      const base = buscarColor(colores, p.color_base, "color_base");
      const color = buscarColor(colores, p.color_nombre, "color_nombre");
      return {
        tipo: TIPOS.llaveroNombre, titulo: nombre + (apellido ? " " + apellido : ""),
        detalles: [{ label: "Base", nombre: base.nombre, hex: base.hex }, { label: "Nombre", nombre: color.nombre, hex: color.hex }],
        precio: apellido ? precios.nombreApellido : precios.nombre, cantidad: cantidadDe(p.cantidad)
      };
    }
    if (tipo === "llavero_logo") {
      const titulo = limpio(p.nombre_logo || p.nombre);
      if (!titulo) fallar("Falta «nombre_logo».");
      const detalle = limpio(p.detalles).slice(0, 120);
      return {
        tipo: TIPOS.llaveroLogo, titulo, detalles: detalle ? [{ label: "Logo", nombre: detalle, hex: "" }] : [],
        precio: precios.logo, cantidad: cantidadDe(p.cantidad)
      };
    }
    if (tipo === "charm" || tipo === "charm_con_cinta") {
      const { texto: t, piezas } = piezasDeCharm(p.texto);
      const medida = texto(p.medida || "55").replace(/\s*cm$/i, "");
      if (medida !== "30" && medida !== "55") fallar("«medida» tiene que ser 30 o 55 (cm).");
      const porPieza = Array.isArray(p.piezas) ? p.piezas : [];
      const detalles = [{ label: "Medida", nombre: medida + " cm", hex: "" }];
      piezas.forEach((c, i) => {
        const o = porPieza[i] || {};
        const base = buscarColor(colores, o.color_base || p.color_base, "color_base");
        const tapa = buscarColor(colores, o.color_tapa || p.color_tapa, "color_tapa");
        detalles.push({ label: c + " · Base", nombre: base.nombre, hex: base.hex });
        detalles.push({ label: c + " · Tapa", nombre: tapa.nombre, hex: tapa.hex });
      });
      (Array.isArray(p.charms) ? p.charms : []).map(limpio).filter(Boolean).forEach((n) => {
        detalles.push({ label: "Charm", nombre: n.slice(0, 100), hex: "" });
      });
      return {
        tipo: TIPOS.charm, titulo: t, detalles,
        precio: medida === "30" ? precios.charm.precio30 : precios.charm.precio55, cantidad: cantidadDe(p.cantidad)
      };
    }
    if (tipo === "marco" || tipo === "marco_de_fotos") {
      const nombre = limpio(p.nombre);
      if (!nombre) fallar("Falta el nombre que lleva el marco.");
      if (nombre.length > 40) fallar("El nombre del marco no puede pasar de 40 caracteres.");
      const fuente = p.fuente
        ? FUENTES_MARCO.find((f) => sinAcentos(f).startsWith(sinAcentos(p.fuente)))
        : FUENTES_MARCO[0];
      if (!fuente) fallar("Fuente desconocida. Opciones: " + FUENTES_MARCO.join(", ") + ".");
      const pieza = buscarColor(colores, p.color_pieza, "color_pieza");
      const marco = buscarColor(colores, p.color_marco, "color_marco");
      return {
        tipo: TIPOS.marco, titulo: nombre,
        detalles: [
          { label: "Pieza", nombre: pieza.nombre, hex: pieza.hex },
          { label: "Marco y nombre", nombre: marco.nombre, hex: marco.hex },
          { label: "Fuente", nombre: fuente, hex: "" }
        ],
        precio: precios.marco, cantidad: cantidadDe(p.cantidad)
      };
    }
    if (tipo === "manual" || tipo === "cotizacion_manual") {
      const titulo = limpio(p.titulo);
      if (!titulo) fallar("Falta el «titulo» de la cotización manual.");
      const precio = Number(p.precio);
      if (!isFinite(precio) || precio < 0) fallar("La cotización manual necesita «precio» (número ≥ 0).");
      const detalles = [];
      (Array.isArray(p.desglose) ? p.desglose : []).forEach((f) => {
        const concepto = limpio(f && f.concepto), detalle = limpio(f && f.detalle);
        if (concepto || detalle) detalles.push({ label: concepto, nombre: detalle, hex: "" });
      });
      (Array.isArray(p.colores) ? p.colores : []).forEach((f) => {
        const color = buscarColor(colores, f && f.color, "colores[].color");
        const n = Math.max(1, Math.floor(Number(f.piezas) || 1));
        detalles.push({ label: n > 1 ? "Color usado ×" + n : "Color usado", nombre: color.nombre, hex: color.hex });
      });
      return { tipo: TIPOS.manual, titulo, detalles, precio: redondear(precio), cantidad: cantidadDe(p.cantidad) };
    }
    fallar("tipo desconocido «" + texto(p && p.tipo) + "». Usa: clicker, llavero_nombre, llavero_logo, charm, marco o manual.");
  } catch (e) {
    if (e instanceof ErrorDeHerramienta) throw new ErrorDeHerramienta(donde + e.message);
    throw e;
  }
}

/* ----------------------------- Lectura del tablero ----------------------------- */

function resumenDe(t) {
  return (t.items || []).map((i) => i.cantidad + "× " + i.tipo + (i.titulo && i.titulo !== i.tipo ? " «" + i.titulo + "»" : "")).join(" · ");
}

function tarjetaCorta(t) {
  return {
    id: t.id, folio: t.folio, cliente: t.cliente, fecha: t.fecha,
    columna: t.columna, columna_nombre: NOMBRES_COLUMNA[t.columna] || t.columna,
    total: t.total, pagado: t.pagado, fecha_pago: t.fechaPago || null,
    productos: resumenDe(t)
  };
}

function tarjetaCompleta(t) {
  return {
    ...tarjetaCorta(t),
    notas: t.notas, unidades: t.unidades, descuento: t.descuento, descuento_nota: t.descuentoNota,
    creada: t.creada, movida: t.movida, creada_por: t.creadaPor, movida_por: t.movidaPor,
    bases_listas: t.basesListas, teclas_listas: t.teclasListas,
    lineas: (t.items || []).map((i, n) => ({
      tipo: i.tipo, titulo: i.titulo, cantidad: i.cantidad, precio: i.precio,
      impreso: (t.itemsListos || []).includes(n),
      detalles: (i.detalles || []).map((d) => ({ pieza: d.label, color: d.nombre, hex: d.hex || undefined }))
    })),
    archivos: (t.archivos || []).map((a) => ({ nombre: a.nombre, tipo: a.tipo, tamano: a.tamano }))
  };
}

const mesDe = (fecha) => (/^\d{4}-\d{2}/.test(texto(fecha)) ? texto(fecha).slice(0, 7) : "sin-fecha");

function estadisticasDe(tarjetas, filtroMes) {
  const enMes = (f) => !filtroMes || mesDe(f) === filtroMes;
  const ventas = { total: 0, tarjetas: 0, por_mes: {} };
  const porColumna = {};
  const cotizado = {}, producido = {}, colores = {};
  const PRODUCIDAS = ["realizado", "entregado"];
  for (const t of tarjetas) {
    porColumna[NOMBRES_COLUMNA[t.columna] || t.columna] = (porColumna[NOMBRES_COLUMNA[t.columna] || t.columna] || 0) + 1;
    if (t.pagado) {
      const m = mesDe(t.fechaPago || t.fecha);
      ventas.por_mes[m] = redondear((ventas.por_mes[m] || 0) + Number(t.total || 0));
      if (enMes(t.fechaPago || t.fecha)) { ventas.total = redondear(ventas.total + Number(t.total || 0)); ventas.tarjetas++; }
    }
    if (!enMes(t.fecha)) continue;
    for (const i of t.items || []) {
      cotizado[i.tipo] = (cotizado[i.tipo] || 0) + i.cantidad;
      if (!PRODUCIDAS.includes(t.columna)) continue;
      producido[i.tipo] = (producido[i.tipo] || 0) + i.cantidad;
      for (const d of i.detalles || []) {
        if (!d.hex || !d.nombre) continue;
        const nombre = texto(d.nombre).replace(/\s*\([^()]*\)\s*$/, "");
        colores[nombre] = (colores[nombre] || 0) + i.cantidad;
      }
    }
  }
  return {
    mes: filtroMes || "todo",
    ventas_pagadas: ventas,
    tarjetas_por_columna: porColumna,
    unidades_cotizadas_por_producto: cotizado,
    unidades_producidas_por_producto: producido,
    nota_producidas: "Producidas = tarjetas en Realizado o Entregado.",
    colores_mas_usados: Object.entries(colores).sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([color, piezas]) => ({ color, piezas }))
  };
}

/* --------------------------------- Herramientas --------------------------------- */

const ESQUEMA_COLOR = { type: "string", description: "Nombre de un color del stock (ver catalogo)." };

const HERRAMIENTAS = [
  {
    name: "catalogo", alcance: "lectura",
    description: "Colores en stock, productos que se pueden cotizar (con sus campos), precios vigentes, columnas del tablero y fuentes del marco. Úsalo antes de crear una cotización.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "listar_tarjetas", alcance: "lectura",
    description: "Lista las cotizaciones del tablero (más recientes primero), con filtros opcionales.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        columna: { type: "string", description: "cotizacion, confirmado, trabajo, fabricado, realizado o entregado." },
        cliente: { type: "string", description: "Parte del nombre del cliente." },
        pagado: { type: "boolean" },
        limite: { type: "integer", minimum: 1, maximum: 100, description: "Cuántas devolver (30 por defecto)." }
      }
    }
  },
  {
    name: "leer_tarjeta", alcance: "lectura",
    description: "Todo lo de una cotización: productos con su desglose de piezas y colores, notas, pago y archivos. Por id o por folio.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { id: { type: "string" }, folio: { type: "integer" } }
    }
  },
  {
    name: "estadisticas", alcance: "lectura",
    description: "Ventas pagadas (total y por mes), tarjetas por columna, unidades cotizadas y producidas por producto y colores más usados. Opcional: un mes AAAA-MM.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { mes: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "AAAA-MM; sin él, todo." } }
    }
  },
  {
    name: "crear_cotizacion", alcance: "escritura",
    description: "Crea una cotización y la pone en la columna «Cotización» del tablero. Los precios los calcula el cotizador (salvo el tipo manual). Los colores van por nombre, del stock (ver catalogo).",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["cliente", "productos"],
      properties: {
        cliente: { type: "string", description: "Nombre del cliente." },
        notas: { type: "string", description: "Instrucciones, contacto, fecha de entrega, enlaces…" },
        referencia: { type: "string", description: "Id propio del pedido: si se repite, no se duplica la cotización." },
        descuento: { type: "number", minimum: 0, description: "Pesos a descontar del total." },
        descuento_nota: { type: "string" },
        productos: {
          type: "array", minItems: 1, maxItems: 50,
          items: {
            type: "object", required: ["tipo"],
            properties: {
              tipo: { type: "string", enum: ["clicker", "llavero_nombre", "llavero_logo", "charm", "marco", "manual"] },
              cantidad: { type: "integer", minimum: 1 },
              nombre: { type: "string", description: "clicker: una palabra (letras, números, emojis). llavero_nombre: nombre. marco: el nombre que lleva." },
              apellido: { type: "string", description: "llavero_nombre (opcional)." },
              color_base: ESQUEMA_COLOR, acabado: { type: "string", enum: ["corrugado", "liso"], description: "clicker: acabado de la base." },
              color_tecla: ESQUEMA_COLOR, color_letra: ESQUEMA_COLOR,
              letras: { type: "array", description: "clicker: cambios por letra, en orden: [{color_base, acabado, color_tecla, color_letra}].", items: { type: "object" } },
              color_nombre: ESQUEMA_COLOR,
              nombre_logo: { type: "string", description: "llavero_logo: cómo se llama el logo." },
              detalles: { type: "string", description: "llavero_logo: colores y detalles del logo." },
              texto: { type: "string", description: "charm: el texto (con espacios, números y signos)." },
              medida: { type: "string", enum: ["30", "55"], description: "charm: cinta de 30 o 55 cm." },
              color_tapa: ESQUEMA_COLOR,
              piezas: { type: "array", description: "charm: cambios por pieza: [{color_base, color_tapa}].", items: { type: "object" } },
              charms: { type: "array", items: { type: "string" }, description: "charm: charms sueltos («pelota de volly»)." },
              fuente: { type: "string", description: "marco: fuente (ver catalogo)." },
              color_pieza: ESQUEMA_COLOR, color_marco: ESQUEMA_COLOR,
              titulo: { type: "string", description: "manual: qué es." },
              precio: { type: "number", description: "manual: precio por unidad." },
              desglose: { type: "array", description: "manual: [{concepto, detalle}].", items: { type: "object" } },
              colores: { type: "array", description: "manual: [{color, piezas}].", items: { type: "object" } }
            }
          }
        }
      }
    }
  }
];

/* ------------------------------------ Servidor ------------------------------------ */

export function crearMcp(app, llaves) {
  const interno = app.interno;
  const lectura = texto(llaves && llaves.lectura).trim();
  const escritura = texto(llaves && llaves.escritura).trim();

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Max-Age": "86400"
  };
  const json = (cuerpo, estado, extra) => new Response(cuerpo == null ? null : JSON.stringify(cuerpo), {
    status: estado || 200,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(extra || {}) }
  });

  // Qué puede hacer quien llama: "escritura", "lectura" o null.
  function alcanceDe(request) {
    const cab = request.headers.get("Authorization") || "";
    const dada = (cab.startsWith("Bearer ") ? cab.slice(7) : "") ||
      request.headers.get("X-Api-Key") || new URL(request.url).searchParams.get("llave") || "";
    if (escritura && mismaLlave(dada.trim(), escritura)) return "escritura";
    if (lectura && mismaLlave(dada.trim(), lectura)) return "lectura";
    return null;
  }

  const permitidas = (alcance) => HERRAMIENTAS.filter((h) => alcance === "escritura" || h.alcance === "lectura");

  async function ejecutar(nombre, args, alcance) {
    const h = HERRAMIENTAS.find((x) => x.name === nombre);
    if (!h) fallar("Herramienta desconocida: " + nombre);
    if (h.alcance === "escritura" && alcance !== "escritura") fallar("Esta llave es de sólo lectura: no puede crear cotizaciones.");
    args = args || {};

    if (nombre === "catalogo") {
      const config = await interno.leerConfig();
      return {
        colores: (config.colores || []).map((c) => ({ nombre: c.nombre, hex: c.hex })),
        precios: {
          clicker: { por_letra_hasta_corte: config.precios.clicer.porLetraCorto, por_letra_despues: config.precios.clicer.porLetraLargo, corte_letras: config.precios.clicer.letrasCorte },
          llavero_nombre: config.precios.nombre, llavero_nombre_y_apellido: config.precios.nombreApellido,
          llavero_logo: config.precios.logo, charm_30cm: config.precios.charm.precio30, charm_55cm: config.precios.charm.precio55,
          marco: config.precios.marco
        },
        productos: {
          clicker: "nombre (una palabra), color_base, acabado (corrugado|liso), color_tecla, color_letra; opcional letras[] por letra. Precio por letra.",
          llavero_nombre: "nombre, apellido opcional, color_base, color_nombre.",
          llavero_logo: "nombre_logo, detalles opcional (la imagen se adjunta después en el tablero).",
          charm: "texto, medida 30|55, color_base, color_tapa, charms[] opcional; opcional piezas[] por pieza.",
          marco: "nombre, fuente opcional, color_pieza, color_marco.",
          manual: "titulo, precio por unidad, desglose[] y colores[] opcionales."
        },
        fuentes_marco: FUENTES_MARCO,
        columnas: interno.columnas.map((id) => ({ id, nombre: NOMBRES_COLUMNA[id] || id }))
      };
    }

    if (nombre === "listar_tarjetas") {
      let lista = await interno.leerTablero();
      if (args.columna) lista = lista.filter((t) => t.columna === sinAcentos(args.columna));
      if (args.cliente) lista = lista.filter((t) => sinAcentos(t.cliente).includes(sinAcentos(args.cliente)));
      if (typeof args.pagado === "boolean") lista = lista.filter((t) => !!t.pagado === args.pagado);
      lista = lista.slice().sort((a, b) => b.folio - a.folio);
      const limite = Math.min(100, Math.max(1, Math.floor(Number(args.limite) || 30)));
      return { total: lista.length, tarjetas: lista.slice(0, limite).map(tarjetaCorta) };
    }

    if (nombre === "leer_tarjeta") {
      let t = null;
      if (args.id) t = /^[0-9a-f-]{36}$/i.test(texto(args.id)) ? await interno.leerTarjeta(texto(args.id)) : null;
      else if (args.folio != null) t = (await interno.leerTablero()).find((x) => Number(x.folio) === Number(args.folio)) || null;
      else fallar("Pasa «id» o «folio».");
      if (!t) fallar("No hay ninguna cotización con ese " + (args.id ? "id" : "folio") + ".");
      return tarjetaCompleta(t);
    }

    if (nombre === "estadisticas") {
      if (args.mes && !/^\d{4}-\d{2}$/.test(texto(args.mes))) fallar("«mes» va como AAAA-MM.");
      return estadisticasDe(await interno.leerTablero(), args.mes || "");
    }

    if (nombre === "crear_cotizacion") {
      const cliente = limpio(args.cliente);
      if (!cliente) fallar("Falta «cliente».");
      if (!Array.isArray(args.productos) || !args.productos.length) fallar("Falta al menos un producto.");
      if (args.productos.length > 50) fallar("Máximo 50 productos por cotización.");
      const config = await interno.leerConfig();
      const items = args.productos.map((p, i) => lineaDe(p, config, i));
      const notas = ("🤖 Creada por un agente (MCP)." + (limpio(args.notas) ? "\n" + texto(args.notas).trim() : "")).slice(0, 2000);
      const referencia = limpio(args.referencia).slice(0, 60);
      const datos = await interno.crearCotizacion({
        clientId: referencia ? "mcp-" + referencia : "mcp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        meta: { cliente, notas, descuento: Number(args.descuento) || 0, descuentoNota: limpio(args.descuento_nota) },
        items
      }, "Agente (MCP)");
      const t = datos.cotizacion;
      return {
        creada: !datos.repetida,
        repetida: !!datos.repetida,
        mensaje: datos.repetida ? "Esa referencia ya existía: no se duplicó." : "Cotización creada en la columna Cotización.",
        ...tarjetaCorta(t),
        lineas: t.items.map((i) => ({ tipo: i.tipo, titulo: i.titulo, cantidad: i.cantidad, precio_unitario: i.precio }))
      };
    }
    fallar("Herramienta sin implementar: " + nombre);
  }

  // Un mensaje JSON-RPC -> su respuesta (o null si es una notificación).
  async function atender(msg, alcance) {
    const id = msg && msg.id;
    const esNotificacion = !msg || msg.id === undefined || msg.id === null;
    const responder = (result) => (esNotificacion ? null : { jsonrpc: "2.0", id, result });
    const error = (code, message) => (esNotificacion ? null : { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });

    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(-32600, "Petición JSON-RPC inválida.");
    const params = msg.params || {};
    switch (msg.method) {
      case "initialize": {
        const pedida = texto(params.protocolVersion);
        return responder({
          protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "cotizador-cubica3d", title: "Cotizador Cubica3D", version: "1.0.0" },
          instructions: "Cotizador de impresión 3D de Cubica3D (México, pesos MXN). Consulta el catálogo antes de cotizar: " +
            "los colores deben ser del stock. " + (alcance === "escritura"
              ? "Con crear_cotizacion la cotización entra a la columna «Cotización» del tablero y el taller la revisa."
              : "Esta llave es de sólo lectura.")
        });
      }
      case "ping": return responder({});
      case "tools/list":
        return responder({
          tools: permitidas(alcance).map((h) => ({ name: h.name, description: h.description, inputSchema: h.inputSchema }))
        });
      case "tools/call":
        try {
          const resultado = await ejecutar(texto(params.name), params.arguments, alcance);
          return responder({ content: [{ type: "text", text: JSON.stringify(resultado, null, 2) }], structuredContent: resultado, isError: false });
        } catch (e) {
          if (e instanceof ErrorDeHerramienta) return responder({ content: [{ type: "text", text: e.message }], isError: true });
          console.error("[mcp] falló " + params.name, e);
          return responder({ content: [{ type: "text", text: "Algo falló en el servidor. Intenta de nuevo." }], isError: true });
        }
      default:
        if (msg.method.startsWith("notifications/")) return null;
        return error(-32601, "Método no soportado: " + msg.method);
    }
  }

  async function fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!lectura && !escritura) return json({ error: "El MCP no está configurado (faltan MCP_LLAVE_LECTURA / MCP_LLAVE_ESCRITURA)." }, 503);
    if (request.method !== "POST") return json({ error: "Usa POST (transporte Streamable HTTP, sin SSE)." }, 405, { Allow: "POST, OPTIONS" });
    const alcance = alcanceDe(request);
    if (!alcance) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Llave inválida o ausente." } }, 401,
        { "WWW-Authenticate": 'Bearer realm="cotizador-cubica3d"' });
    }
    let cuerpo;
    try { cuerpo = JSON.parse(await request.text()); } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } }, 400);
    }
    if (Array.isArray(cuerpo)) {
      const respuestas = (await Promise.all(cuerpo.map((m) => atender(m, alcance)))).filter(Boolean);
      return respuestas.length ? json(respuestas) : new Response(null, { status: 202, headers: cors });
    }
    const respuesta = await atender(cuerpo, alcance);
    return respuesta ? json(respuesta) : new Response(null, { status: 202, headers: cors });
  }

  return { fetch };
}
