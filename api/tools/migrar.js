/* Pasa a Neon lo que hoy vive en el localStorage de un navegador.
 *
 *   1) En el navegador con los datos: pegá tools/respaldo-localstorage.js en la
 *      consola (F12) y se descarga respaldo-cubica3d.json.
 *   2) cd api && npm run migrar -- ../respaldo-cubica3d.json
 *
 * Es idempotente y se puede correr las veces que haga falta: cada tarjeta se
 * marca con client_id = "migrado:<id original>", así que las ya migradas se
 * saltean en lugar de duplicarse. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { conectar } from "./conectar.js";

const COLUMNAS = ["cotizacion", "trabajo", "realizado"];

function limpiarItems(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((it) => it && typeof it.titulo === "string" && it.titulo.trim())
    .map((it) => ({
      tipo: String(it.tipo || "Producto").slice(0, 40),
      titulo: it.titulo.trim().slice(0, 120),
      precio: Math.max(0, Number(String(it.precio || 0).replace(",", ".")) || 0),
      cantidad: Math.max(1, Math.floor(Number(it.cantidad) || 1)),
      detalles: (Array.isArray(it.detalles) ? it.detalles : []).map((d) => ({
        label: String((d || {}).label || "").slice(0, 60),
        nombre: String((d || {}).nombre || "").slice(0, 120),
        hex: String((d || {}).hex || "").slice(0, 20)
      }))
    }));
}

function iso(valor) {
  if (!valor) return null;
  const fecha = new Date(valor);
  return isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function fechaCorta(valor) {
  const texto = String(valor || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

// Migra un respaldo ya leído. Se exporta para poder probarla contra un Postgres
// real en memoria (__migrar.pglite.test.js) sin tocar ninguna base de verdad.
export async function migrar(respaldo, query, log) {
  log = log || console.log;
  const config = respaldo.config || {};
  const tarjetas = (respaldo.proceso && respaldo.proceso.tarjetas) || [];
  const resumen = { config: 0, creadas: 0, salteadas: 0, items: 0, foliosReasignados: [] };

  log("Respaldo con " + tarjetas.length + " tarjeta(s) y " +
    ((config.colores || []).length) + " color(es) de stock.");

  // -------------------------------------------------------------- Configuración
  const colores = (Array.isArray(config.colores) ? config.colores : [])
    .filter((c) => c && /^#[0-9a-fA-F]{6}$/.test(String(c.hex || "")))
    .map((c) => ({ id: String(c.id || ""), nombre: String(c.nombre || "Sin nombre"), hex: String(c.hex) }));
  const precios = {
    nombre: Number((config.precios || {}).nombre) || 0,
    nombreApellido: Number((config.precios || {}).nombreApellido) || 0
  };
  if (colores.length || precios.nombre || precios.nombreApellido) {
    await query(
      "insert into configuracion (id, colores, precios, actualizada, actualizada_por)" +
      " values ('default', $1::jsonb, $2::jsonb, now(), 'migración')" +
      " on conflict (id) do update set colores = $1::jsonb, precios = $2::jsonb," +
      " actualizada = now(), actualizada_por = 'migración'",
      [JSON.stringify(colores), JSON.stringify(precios)]
    );
    resumen.config = colores.length ? 1 : 0;
  }

  // ------------------------------------------------------------------ Tarjetas
  const { rows: folios } = await query("select folio from cotizaciones");
  const usados = new Set(folios.map((f) => Number(f.folio)));

  // El contador tiene que arrancar POR ENCIMA del folio más alto del respaldo:
  // si no, al reasignar un folio repetido entregaría uno ya existente.
  const maxRespaldo = tarjetas.reduce((max, t) => {
    const n = parseInt(t && t.folio, 10);
    return isFinite(n) && n > max ? n : max;
  }, 0);
  if (maxRespaldo > 0) {
    await query("update folios set ultimo = greatest(ultimo, $1::int) where id = 'default'", [maxRespaldo]);
  }

  for (const columna of COLUMNAS) {
    // El orden del arreglo ES el orden visual: la primera de la columna va arriba.
    const deLaColumna = tarjetas.filter((t) => t && t.columna === columna);
    for (let i = 0; i < deLaColumna.length; i++) {
      const t = deLaColumna[i];
      const items = limpiarItems(t.items);
      if (!items.length) {
        resumen.salteadas += 1;
        continue;
      }
      const unidades = items.reduce((suma, it) => suma + it.cantidad, 0);
      const total = Math.round(items.reduce((suma, it) => suma + it.precio * it.cantidad, 0) * 100) / 100;

      const folioPedido = parseInt(t.folio, 10);
      const folioSirve = isFinite(folioPedido) && folioPedido > 0 && !usados.has(folioPedido);
      const folio = folioSirve ? folioPedido : null;   // null = se lo pedimos a la base

      const { rows } = await query(
        "insert into cotizaciones (client_id, folio, fecha, cliente, notas, columna, posicion," +
        " unidades, total, creada, movida, creada_por, movida_por)" +
        " values ($1, coalesce($2::int, siguiente_folio()), coalesce($3::date, current_date)," +
        " $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), coalesce($11::timestamptz, now()), $12, $12)" +
        " on conflict (client_id) do nothing returning id, folio",
        [
          "migrado:" + String(t.id || columna + ":" + i),
          folio,
          fechaCorta(t.fecha),
          String(t.cliente || "").slice(0, 120),
          String(t.notas || "").slice(0, 600),
          columna,
          1000 + i * 10,
          unidades,
          total,
          iso(t.creada),
          iso(t.movida),
          "migración"
        ]
      );

      if (!rows.length) {
        resumen.salteadas += 1;
        continue;
      }
      usados.add(Number(rows[0].folio));
      if (folio === null && isFinite(folioPedido) && folioPedido > 0) {
        resumen.foliosReasignados.push(folioPedido + " → " + rows[0].folio);
      }

      await query(
        "insert into cotizacion_items (cotizacion_id, orden, tipo, titulo, precio, cantidad, detalles)" +
        " select $1, i.orden, i.tipo, i.titulo, i.precio, i.cantidad, i.detalles" +
        " from jsonb_to_recordset($2::jsonb) as i(orden int, tipo text, titulo text," +
        " precio numeric, cantidad int, detalles jsonb)",
        [rows[0].id, JSON.stringify(items.map((it, orden) => ({ ...it, orden })))]
      );
      resumen.items += items.length;
      resumen.creadas += 1;
    }
  }

  // El folio nuevo tiene que seguir después de lo migrado.
  await query(
    "update folios set ultimo = greatest(ultimo, coalesce((select max(folio) from cotizaciones), 0))" +
    " where id = 'default'"
  );

  const { rows: siguiente } = await query("select ultimo + 1 as n from folios where id = 'default'");
  log("Configuración migrada: " + (resumen.config ? "sí" : "sin colores, se salteó"));
  log("Tarjetas creadas: " + resumen.creadas + " (con " + resumen.items + " líneas)");
  log("Tarjetas salteadas (ya estaban o sin productos): " + resumen.salteadas);
  if (resumen.foliosReasignados.length) {
    log("Folios repetidos que se reasignaron: " + resumen.foliosReasignados.join(", "));
  }
  log("El próximo folio que va a entregar el servidor es el " + siguiente[0].n + ".");
  log("El carrito en armado no se migra a propósito: sigue siendo local a cada navegador.");

  return resumen;
}

async function main() {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error("Uso: npm run migrar -- ../respaldo-cubica3d.json");
    process.exit(1);
  }
  const respaldo = JSON.parse(readFileSync(ruta, "utf8"));
  const { query, cerrar } = await conectar();
  try {
    await migrar(respaldo, query);
  } catch (error) {
    console.error("Falló la migración:", error.message);
    process.exitCode = 1;
  } finally {
    await cerrar();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

