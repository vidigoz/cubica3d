/* Archivos de impresión para la Bambu Lab (SÓLO servidor local, de momento).
 *
 * De una orden de producción (las bases y las teclas que ya agrupa js/po.js) arma
 * PLATAFORMAS de impresión: un .3mf por plataforma, con cada pieza ya acomodada en
 * la cama y cada cuerpo asignado a su bahía de color. Las reglas:
 *
 *   · la impresora sólo tiene 3 bahías: ninguna plataforma lleva más de 3 colores.
 *     Si la orden trae más, se reparte en varias plataformas;
 *   · las piezas salen de la carpeta stl/ (ver README): «Base Corrugada.stl»,
 *     «Base Lisa.stl» y Letras/…keycap-char-X.stl. La tecla es UN archivo con dos
 *     cuerpos (la tecla y la letra encima), así que cada uno puede ir de su color;
 *   · lo que no tiene STL (Ñ, acentos, emojis) no se imprime y se avisa.
 *
 * El .3mf sigue el formato de Bambu Studio (objetos con partes y `extruder`), pero
 * es la primera versión: hay que abrirlo en Bambu Studio y confirmar los colores. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

export const AJUSTES = {
  maxColores: 3,
  ancho: 256,        // la cama, en mm (X1 / P1 / A1: 256×256)
  alto: 256,
  margen: 6,         // lo que se deja libre en el borde
  separacion: 4      // entre pieza y pieza
};

/* ------------------------------- Lectura STL ------------------------------- */

// Devuelve los triángulos como Float32Array (9 números por triángulo).
export function leerSTL(buffer) {
  if (buffer.length >= 84) {
    const n = buffer.readUInt32LE(80);
    if (84 + n * 50 === buffer.length) {
      const tri = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const base = 84 + i * 50 + 12;           // se salta la normal
        for (let k = 0; k < 9; k++) tri[i * 9 + k] = buffer.readFloatLE(base + k * 4);
      }
      return tri;
    }
  }
  // STL de texto
  const nums = [];
  for (const m of buffer.toString("utf8").matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  return Float32Array.from(nums);
}

// Une los vértices repetidos: { v: [x,y,z,…], f: [a,b,c,…] }
function indexar(tri) {
  const mapa = new Map();
  const v = [];
  const f = [];
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2];
    const clave = x.toFixed(4) + "," + y.toFixed(4) + "," + z.toFixed(4);
    let id = mapa.get(clave);
    if (id === undefined) {
      id = v.length / 3;
      mapa.set(clave, id);
      v.push(x, y, z);
    }
    f.push(id);
  }
  return { v, f };
}

// Separa la malla en cuerpos sueltos (piezas que no se tocan), del más grande al
// más chico por volumen: en una tecla, el primero es la tecla y el segundo la letra.
function separar(malla) {
  const { v, f } = malla;
  const nv = v.length / 3;
  const padre = Array.from({ length: nv }, (_, i) => i);
  const raiz = (i) => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };
  for (let i = 0; i < f.length; i += 3) {
    const a = raiz(f[i]);
    for (const b of [raiz(f[i + 1]), raiz(f[i + 2])]) if (a !== b) padre[b] = a;
  }
  const cuerpos = new Map();
  for (let i = 0; i < f.length; i += 3) {
    const r = raiz(f[i]);
    if (!cuerpos.has(r)) cuerpos.set(r, []);
    cuerpos.get(r).push(f[i], f[i + 1], f[i + 2]);
  }
  const lista = [];
  for (const caras of cuerpos.values()) {
    const nuevo = new Map();
    const vv = [];
    const ff = caras.map((id) => {
      if (!nuevo.has(id)) { nuevo.set(id, vv.length / 3); vv.push(v[id * 3], v[id * 3 + 1], v[id * 3 + 2]); }
      return nuevo.get(id);
    });
    let vol = 0;
    for (let i = 0; i < ff.length; i += 3) {
      const [a, b, c] = [ff[i] * 3, ff[i + 1] * 3, ff[i + 2] * 3];
      vol += (vv[a] * (vv[b + 1] * vv[c + 2] - vv[b + 2] * vv[c + 1]) -
        vv[a + 1] * (vv[b] * vv[c + 2] - vv[b + 2] * vv[c]) +
        vv[a + 2] * (vv[b] * vv[c + 1] - vv[b + 1] * vv[c])) / 6;
    }
    lista.push({ v: vv, f: ff, volumen: Math.abs(vol) });
  }
  return lista.sort((a, b) => b.volumen - a.volumen);
}

// Una pieza lista para colocar: sus cuerpos movidos al origen (esquina mínima en 0,0,0).
function cargarPieza(archivo, unirCuerpos) {
  const malla = indexar(leerSTL(readFileSync(archivo)));
  let cuerpos = unirCuerpos ? [{ v: malla.v, f: malla.f }] : separar(malla);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of cuerpos) {
    for (let i = 0; i < c.v.length; i++) {
      min[i % 3] = Math.min(min[i % 3], c.v[i]);
      max[i % 3] = Math.max(max[i % 3], c.v[i]);
    }
  }
  cuerpos = cuerpos.map((c) => ({ f: c.f, v: c.v.map((n, i) => n - min[i % 3]) }));
  return { cuerpos, w: max[0] - min[0], d: max[1] - min[1], h: max[2] - min[2] };
}

/* -------------------------------- Catálogo -------------------------------- */

// Lee la carpeta stl/. Las teclas se cargan al pedirlas (son muchas y pesadas).
export function catalogo(carpeta) {
  const cat = { bases: {}, teclas: {}, _cache: new Map() };
  if (!existsSync(carpeta)) return cat;
  for (const nombre of readdirSync(carpeta)) {
    if (!/\.stl$/i.test(nombre)) continue;
    if (/corrug/i.test(nombre)) cat.bases.corrugado = join(carpeta, nombre);
    else if (/lis[oa]/i.test(nombre)) cat.bases.liso = join(carpeta, nombre);
  }
  const letras = join(carpeta, "Letras");
  if (existsSync(letras)) {
    for (const nombre of readdirSync(letras)) {
      const m = /keycap-char-(.+)\.stl$/i.exec(nombre);
      if (m) cat.teclas[m[1].toUpperCase()] = join(letras, nombre);
    }
  }
  return cat;
}

function piezaDe(cat, clave) {
  if (!cat._cache.has(clave)) {
    const [tipo, id] = clave.split(":");
    const archivo = tipo === "base" ? cat.bases[id] : cat.teclas[id];
    cat._cache.set(clave, cargarPieza(archivo, tipo === "base"));
  }
  return cat._cache.get(clave);
}

/* ------------------------------ De la PO a piezas ------------------------------ */

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const colorDe = (c) => ({ hex: String((c && c.hex) || "").toLowerCase(), nombre: String((c && c.nombre) || "").trim() });
const claveColor = (c) => c.hex + "|" + c.nombre;
const cantidadDe = (n) => Math.max(0, Math.floor(Number(n) || 0));

// Una instancia es UNA pieza física: { clave, texto, colores: [color de cada cuerpo] }.
export function instanciasDe(orden, cat) {
  const lista = [];
  const avisos = [];
  const sinSTL = new Map();

  for (const g of (orden && orden.bases) || []) {
    const acabado = /corrug/.test(sinTildes(g.acabado)) ? "corrugado" : "liso";
    if (!cat.bases[acabado]) {
      avisos.push("Falta el STL de la base " + acabado + ": no se incluyeron " + cantidadDe(g.cantidad) + " bases.");
      continue;
    }
    const color = colorDe(g);
    for (let i = 0; i < cantidadDe(g.cantidad); i++) {
      lista.push({ clave: "base:" + acabado, texto: "Base " + acabado, colores: [color] });
    }
  }

  for (const g of (orden && orden.teclas) || []) {
    const tecla = colorDe(g.tecla);
    const letra = colorDe(g.letra);
    for (const forma of g.formas || []) {
      const caracter = String(forma.caracter || "").toUpperCase();
      const n = cantidadDe(forma.cantidad);
      if (!cat.teclas[caracter]) {
        sinSTL.set(caracter, (sinSTL.get(caracter) || 0) + n);
        continue;
      }
      for (let i = 0; i < n; i++) {
        lista.push({ clave: "tecla:" + caracter, texto: "Tecla " + caracter, colores: [tecla, letra] });
      }
    }
  }

  for (const [caracter, n] of sinSTL) {
    avisos.push("«" + caracter + "» no tiene STL (" + n + (n === 1 ? " tecla" : " teclas") + "): no se imprime.");
  }
  return { lista, avisos };
}

/* --------------------------------- Plataformas --------------------------------- */

// Acomoda piezas por filas. Devuelve lo que cupo (con su posición) y lo que sobró.
export function acomodar(insts, huella, aj = AJUSTES) {
  const orden = [...insts].sort((a, b) => huella(b).d - huella(a).d || huella(b).w - huella(a).w);
  const colocadas = [];
  const sobran = [];
  const x0 = aj.margen, x1 = aj.ancho - aj.margen, y1 = aj.alto - aj.margen;
  let x = x0, y = aj.margen, filaAlto = 0;
  for (const inst of orden) {
    const { w, d } = huella(inst);
    if (x + w > x1) { x = x0; y += filaAlto + aj.separacion; filaAlto = 0; }
    if (y + d > y1 || w > x1 - x0) { sobran.push(inst); continue; }
    colocadas.push({ inst, x, y });
    x += w + aj.separacion;
    filaAlto = Math.max(filaAlto, d);
  }
  return { colocadas, sobran };
}

function subconjuntos(colores, max) {
  const salida = [];
  const n = colores.length;
  for (let i = 0; i < n; i++) {
    salida.push([colores[i]]);
    for (let j = i + 1; j < n; j++) {
      salida.push([colores[i], colores[j]]);
      for (let k = j + 1; k < n && max >= 3; k++) salida.push([colores[i], colores[j], colores[k]]);
    }
  }
  return salida;
}

// Reparte las instancias en plataformas de a lo más `maxColores` colores.
export function planificar(insts, huella, aj = AJUSTES) {
  const clavesDe = (inst) => [...new Set(inst.colores.map(claveColor))];
  let pool = insts.slice();
  let plataformas = [];

  while (pool.length) {
    // Qué tanta superficie cubre cada juego posible de colores.
    const tipos = new Map();
    for (const inst of pool) {
      const claves = clavesDe(inst);
      const id = claves.slice().sort().join("~");
      const h = huella(inst);
      const t = tipos.get(id) || { claves, area: 0 };
      t.area += h.w * h.d;
      tipos.set(id, t);
    }
    const todos = [...new Set([...tipos.values()].flatMap((t) => t.claves))].sort();
    let mejor = null;
    for (const sub of subconjuntos(todos, aj.maxColores)) {
      const set = new Set(sub);
      let area = 0;
      for (const t of tipos.values()) if (t.claves.every((c) => set.has(c))) area += t.area;
      if (!mejor || area > mejor.area || (area === mejor.area && sub.length > mejor.sub.length)) mejor = { sub, area };
    }
    const set = new Set(mejor.sub);
    const cubiertas = pool.filter((inst) => clavesDe(inst).every((c) => set.has(c)));
    const { colocadas, sobran } = acomodar(cubiertas, huella, aj);
    plataformas.push({ colocadas });
    const idsColocadas = new Set(colocadas.map((c) => c.inst));
    pool = pool.filter((inst) => !idsColocadas.has(inst));
    if (!colocadas.length) throw new Error("Una pieza no cabe en la cama de " + aj.ancho + "×" + aj.alto + " mm.");
    void sobran;
  }

  // Si dos plataformas caben juntas (≤3 colores y todo en una cama), se unen.
  const coloresDe = (p) => new Set(p.colocadas.flatMap((c) => clavesDe(c.inst)));
  let unido = true;
  while (unido) {
    unido = false;
    for (let i = 0; i < plataformas.length && !unido; i++) {
      for (let j = i + 1; j < plataformas.length && !unido; j++) {
        const u = new Set([...coloresDe(plataformas[i]), ...coloresDe(plataformas[j])]);
        if (u.size > aj.maxColores) continue;
        const todas = [...plataformas[i].colocadas, ...plataformas[j].colocadas].map((c) => c.inst);
        const r = acomodar(todas, huella, aj);
        if (r.sobran.length) continue;
        plataformas[i] = { colocadas: r.colocadas };
        plataformas.splice(j, 1);
        unido = true;
      }
    }
  }

  // Bahías: cada color conserva la de la plataforma anterior si puede (menos cambios
  // de filamento); el resto se reparte por uso.
  let previa = new Map();
  plataformas = plataformas.map((p, i) => {
    const uso = new Map();
    const info = new Map();
    for (const { inst } of p.colocadas) {
      const h = huella(inst);
      for (const c of inst.colores) {
        uso.set(claveColor(c), (uso.get(claveColor(c)) || 0) + h.w * h.d);
        info.set(claveColor(c), c);
      }
    }
    const colores = [...uso.keys()].sort((a, b) => uso.get(b) - uso.get(a));
    const bahia = new Map();
    const ocupadas = new Set();
    for (const c of colores) {
      const b = previa.get(c);
      if (b && !ocupadas.has(b)) { bahia.set(c, b); ocupadas.add(b); }
    }
    for (const c of colores) {
      if (bahia.has(c)) continue;
      let b = 1;
      while (ocupadas.has(b)) b++;
      bahia.set(c, b); ocupadas.add(b);
    }
    previa = bahia;
    return {
      numero: i + 1,
      colocadas: p.colocadas,
      bahias: colores.map((c) => ({ bahia: bahia.get(c), clave: c, ...info.get(c) })).sort((a, b) => a.bahia - b.bahia),
      bahiaDe: bahia
    };
  });
  return plataformas;
}

/* ----------------------------------- 3MF ----------------------------------- */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => (Math.round(n * 10000) / 10000).toString();

export function construir3MF(plataforma, cat, titulo) {
  // Un objeto por tipo de pieza + colores; sus copias son instancias del objeto.
  const objetos = new Map();
  for (const c of plataforma.colocadas) {
    const id = c.inst.clave + "|" + c.inst.colores.map(claveColor).join("+");
    if (!objetos.has(id)) objetos.set(id, { inst: c.inst, lugares: [] });
    objetos.get(id).lugares.push(c);
  }

  let sig = 1;
  let mallas = "";
  let envolturas = "";
  let construccion = "";
  let ajustes = "";
  let instancias = "";
  let identificador = 0;

  for (const obj of objetos.values()) {
    const pieza = piezaDe(cat, obj.inst.clave);
    const idsCuerpo = pieza.cuerpos.map((c) => {
      const id = sig++;
      mallas += '  <object id="' + id + '" type="model"><mesh><vertices>' +
        Array.from({ length: c.v.length / 3 }, (_, i) =>
          '<vertex x="' + num(c.v[i * 3]) + '" y="' + num(c.v[i * 3 + 1]) + '" z="' + num(c.v[i * 3 + 2]) + '"/>').join("") +
        "</vertices><triangles>" +
        Array.from({ length: c.f.length / 3 }, (_, i) =>
          '<triangle v1="' + c.f[i * 3] + '" v2="' + c.f[i * 3 + 1] + '" v3="' + c.f[i * 3 + 2] + '"/>').join("") +
        "</triangles></mesh></object>\n";
      return id;
    });
    const envoltura = sig++;
    envolturas += '  <object id="' + envoltura + '" type="model"><components>' +
      idsCuerpo.map((id) => '<component objectid="' + id + '"/>').join("") + "</components></object>\n";

    const colores = obj.inst.colores;
    const extruderDe = (i) => plataforma.bahiaDe.get(claveColor(colores[Math.min(i, colores.length - 1)]));
    ajustes += '  <object id="' + envoltura + '">\n' +
      '    <metadata key="name" value="' + esc(obj.inst.texto) + '"/>\n' +
      '    <metadata key="extruder" value="' + extruderDe(0) + '"/>\n' +
      idsCuerpo.map((id, i) =>
        '    <part id="' + id + '" subtype="normal_part">\n' +
        '      <metadata key="name" value="' + esc(obj.inst.texto + (idsCuerpo.length > 1 ? (i === 0 ? " (tecla)" : " (letra)") : "")) + '"/>\n' +
        '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
        '      <metadata key="extruder" value="' + extruderDe(i) + '"/>\n' +
        "    </part>\n").join("") +
      "  </object>\n";

    obj.lugares.forEach((lugar, k) => {
      construccion += '    <item objectid="' + envoltura + '" transform="1 0 0 0 1 0 0 0 1 ' +
        num(lugar.x) + " " + num(lugar.y) + ' 0" printable="1"/>\n';
      instancias += "    <model_instance>\n" +
        '      <metadata key="object_id" value="' + envoltura + '"/>\n' +
        '      <metadata key="instance_id" value="' + k + '"/>\n' +
        '      <metadata key="identify_id" value="' + (++identificador + 100) + '"/>\n' +
        "    </model_instance>\n";
    });
  }

  const modelo = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
    ' <metadata name="Application">BambuStudio-01.10.00.00</metadata>\n' +
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
    ' <metadata name="Title">' + esc(titulo) + "</metadata>\n" +
    " <resources>\n" + mallas + envolturas + " </resources>\n" +
    " <build>\n" + construccion + " </build>\n</model>\n";

  const config = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + ajustes +
    "  <plate>\n" +
    '    <metadata key="plater_id" value="1"/>\n' +
    '    <metadata key="plater_name" value=""/>\n' +
    '    <metadata key="locked" value="false"/>\n' +
    instancias + "  </plate>\n</config>\n";

  return zip([
    { nombre: "[Content_Types].xml", datos: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>' },
    { nombre: "_rels/.rels", datos: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { nombre: "3D/3dmodel.model", datos: modelo },
    { nombre: "Metadata/model_settings.config", datos: config }
  ]);
}

/* ------------------------------------ ZIP ------------------------------------ */

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(archivos) {
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, "utf8");
    const crudo = Buffer.isBuffer(a.datos) ? a.datos : Buffer.from(a.datos, "utf8");
    const comprimido = deflateRawSync(crudo);
    const crc = crc32(crudo);
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0); cab.writeUInt16LE(20, 4); cab.writeUInt16LE(0x0800, 6);
    cab.writeUInt16LE(8, 8); cab.writeUInt32LE(crc, 14);
    cab.writeUInt32LE(comprimido.length, 18); cab.writeUInt32LE(crudo.length, 22);
    cab.writeUInt16LE(nombre.length, 26);
    locales.push(cab, nombre, comprimido);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comprimido.length, 20); cen.writeUInt32LE(crudo.length, 24);
    cen.writeUInt16LE(nombre.length, 28); cen.writeUInt32LE(desplazamiento, 42);
    centrales.push(cen, nombre);
    desplazamiento += cab.length + nombre.length + comprimido.length;
  }
  const dirCentral = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10); fin.writeUInt32LE(dirCentral.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, dirCentral, fin]);
}

/* ----------------------------------- Todo junto ----------------------------------- */

const limpio = (s) => String(s || "orden").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "orden";

// pedido: { titulo, bases: [...], teclas: [...] } (los grupos de PO.leer).
// Devuelve { archivos: [{ nombre, datos: Buffer }] (un .3mf por plataforma), resumen }.
export function generar(pedido, carpetaSTL, aj = AJUSTES) {
  const cat = catalogo(carpetaSTL);
  const { lista, avisos } = instanciasDe(pedido, cat);
  if (!lista.length) {
    throw Object.assign(new Error(avisos.join(" ") || "La orden no trae bases ni teclas para imprimir."), { estado: 400 });
  }
  const huella = (inst) => piezaDe(cat, inst.clave);
  const plataformas = planificar(lista, huella, aj);
  const titulo = String(pedido.titulo || "Orden");
  const base = limpio(titulo);

  const archivos = plataformas.map((p) => ({
    nombre: base + "-plataforma-" + p.numero + "-de-" + plataformas.length + ".3mf",
    datos: construir3MF(p, cat, titulo + " · plataforma " + p.numero)
  }));

  const resumen = {
    titulo,
    total: lista.length,
    avisos,
    plataformas: plataformas.map((p, i) => {
      const cuenta = new Map();
      for (const { inst } of p.colocadas) cuenta.set(inst.texto, (cuenta.get(inst.texto) || 0) + 1);
      return {
        numero: p.numero,
        archivo: archivos[i].nombre,
        piezas: p.colocadas.length,
        bahias: p.bahias.map((b) => ({ bahia: b.bahia, nombre: b.nombre, hex: b.hex })),
        contenido: [...cuenta].map(([texto, cantidad]) => ({ texto, cantidad }))
          .sort((a, b) => a.texto.localeCompare(b.texto))
      };
    })
  };

  return { archivos, resumen };
}
