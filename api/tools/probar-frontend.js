/* Verifica que el FRONTEND guarde de verdad en Neon.
 *
 * Carga los mismos archivos que usa el navegador (js/utils.js, js/api.js,
 * js/store.js, js/proceso.js) sobre un `window` de mentira y hace lo que haría
 * una persona: entra, agrega un color, envía una cotización, la mueve de columna
 * y la quita del tablero. Después vuelve a preguntarle al servidor si cada paso
 * quedó guardado: si quedó, está en Postgres (Neon).
 *
 * Necesita el API levantado. Dos formas:
 *   1) En otra terminal:  netlify dev     (sirve el sitio en http://localhost:8888)
 *      node api/tools/probar-frontend.js
 *   2) Sólo el API:       cd api && npm run server     (http://localhost:8787)
 *      CUBICA_API=http://localhost:8787/api node api/tools/probar-frontend.js
 *
 * Usa una cuenta de prueba (creala una vez con):
 *   cd api && npm run usuario -- "prueba@cubica3d.local" "Prueba" "una-clave"
 * y se le puede cambiar con PRUEBA_EMAIL / PRUEBA_PASSWORD.
 *
 * No rompe nada: el color que agrega lo vuelve a quitar, y la cotización la
 * quita del tablero al terminar (el borrado del API es suave: la fila queda en
 * la base con borrada_en marcado, que es justo lo que queremos comprobar). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const aca = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aca, "..", "..");

const BASE = (process.env.CUBICA_API || "http://localhost:8888/api").replace(/\/+$/, "");
const EMAIL = process.env.PRUEBA_EMAIL || "prueba@cubica3d.local";
const PASSWORD = process.env.PRUEBA_PASSWORD || "cubica-prueba-2026";

/* ------------------------- El navegador, de mentira ------------------------- */

const almacen = new Map();

globalThis.window = globalThis;
globalThis.CUBICA_API = BASE;
globalThis.localStorage = {
  getItem: (clave) => (almacen.has(clave) ? almacen.get(clave) : null),
  setItem: (clave, valor) => almacen.set(clave, String(valor)),
  removeItem: (clave) => almacen.delete(clave)
};
globalThis.document = { hidden: false };   // el sondeo del tablero pregunta por acá
globalThis.App = {
  toast: (mensaje, tipo) => console.log("      · toast " + (tipo || "info") + ": " + mensaje),
  navigate: () => {}
};

// Se cargan en el mismo orden que index.html.
["js/utils.js", "js/api.js", "js/store.js", "js/clicer.js", "js/proceso.js"].forEach((relativo) => {
  const ruta = resolve(raiz, relativo);
  vm.runInThisContext(readFileSync(ruta, "utf8"), { filename: ruta });
});

const Api = globalThis.Api;
const Store = globalThis.Store;
const Clicer = globalThis.Clicer;
const Proceso = globalThis.Proceso;


/* ------------------------------- Andamiaje ------------------------------- */

let fallas = 0;

function titulo(texto) {
  console.log("\n" + texto);
}

function afirmar(condicion, texto) {
  if (condicion) console.log("  OK    " + texto);
  else { fallas += 1; console.log("  FALLA " + texto); }
}

// Vuelve a preguntarle al servidor: lo de acá salió de Postgres, no de memoria.
async function servidor() {
  const datos = await Api.bootstrap();
  Store.init(datos.config, datos.configActualizada);
  Proceso.init(datos);
  return datos;
}

function esperar(ms) {
  return new Promise(function (listo) { setTimeout(listo, ms); });
}


/* -------------------------------- La prueba -------------------------------- */

async function principal() {
  console.log("Probando el frontend contra " + BASE);
  console.log("Cuenta: " + EMAIL + "\n");

  titulo("1) Entrar (POST /api/login)");
  const usuario = await Api.login(EMAIL, PASSWORD);
  console.log("  OK    sesión abierta como " + usuario.nombre + " <" + usuario.email + ">");
  afirmar(!!Api.haySesion(), "el token quedó guardado en el navegador");

  titulo("2) Traer todo (GET /api/bootstrap)");
  const datos = await servidor();
  console.log("  ·     configuración: " + datos.config.colores.length + " color(es) en stock");
  console.log("  ·     tablero: " + datos.cotizaciones.length + " tarjeta(s)");
  console.log("  ·     folio que sigue: " + datos.folioSiguiente + "  ·  hora del servidor: " + datos.servidorHora);

  titulo("3) Configuración: agregar un color (PUT /api/config)");
  const nombreColor = "Prueba frontend " + new Date().toISOString().slice(11, 19);
  const alta = Store.addColor(nombreColor, "#1E88E5");
  afirmar(alta.ok, "el color pasó la validación del frontend: " + nombreColor);
  await Store.pendiente();

  let revisado = await servidor();
  const guardado = revisado.config.colores.filter((c) => c.nombre === nombreColor);
  afirmar(guardado.length === 1, "el color está en la base (" + revisado.config.colores.length + " en stock)");

  titulo("4) Deshacer: quitar ese mismo color (PUT /api/config)");
  if (guardado[0]) {
    Store.removeColor(guardado[0].id);
    await Store.pendiente();
    revisado = await servidor();
    afirmar(!revisado.config.colores.some((c) => c.nombre === nombreColor), "el color ya no está en la base");
  }

  titulo("5) Enviar una cotización con los DOS productos (POST /api/cotizaciones)");
  const clientId = "prueba-" + Date.now().toString(36);
  const meta = {
    folio: String(Proceso.siguienteFolio()),
    fecha: new Date().toISOString().slice(0, 10),
    cliente: "Cliente de prueba",
    notas: "La genera api/tools/probar-frontend.js"
  };

  // El clicker: cada letra con sus TRES piezas (base con su acabado, tecla y
  // letra) y cada pieza con su color. El precio y el desglose salen de las MISMAS
  // funciones que usa la vista (js/clicer.js), así que lo que se manda acá es
  // exactamente lo que se manda al cotizar en la app.
  const nombreClicer = "Victor";
  const letras = Clicer.letrasDe(nombreClicer).letras;
  const colores = Store.getConfig().colores;
  const colorDe = (i) => colores[i % colores.length] || { nombre: "Negro", hex: "#111111" };
  const precioClicer = Clicer.precioDe(Store.getConfig(), letras.length).total;
  const detallesClicer = Clicer.detallesDe(Clicer.piezasDe(letras, {
    base: letras.map((_, i) => colorDe(i)),
    acabado: letras.map((_, i) => (i % 2 ? "Liso" : "Corrugado")),
    tecla: letras.map((_, i) => colorDe(i + 1)),
    letra: letras.map((_, i) => colorDe(i + 2))
  }));

  const creada = await Proceso.crear({
    clientId: clientId,
    meta: meta,
    items: [
      { tipo: "Llavero de Nombre", titulo: "Ana Prueba", precio: 100, cantidad: 2,
        detalles: [{ label: "Base", nombre: "Negro", hex: "#111111" },
                   { label: "Nombre", nombre: "Rojo", hex: "#D32F2F" }] },
      { tipo: "Llavero de Nombre", titulo: "Luis Prueba", precio: 60, cantidad: 1, detalles: [] },
      { tipo: "Clicker de Nombre", titulo: nombreClicer, precio: precioClicer, cantidad: 1,
        detalles: detallesClicer }
    ]
  });

  const tarjeta = creada.tarjeta;
  console.log("  ·     tarjeta creada: folio " + tarjeta.folio + "  ·  id " + tarjeta.id);
  console.log("  ·     clicker «" + nombreClicer + "»: " + letras.length + " letras × 3 piezas, $" + precioClicer +
    " (precio por letra de Configuración → Precios)");
  console.log("  ·     total que calculó el servidor: $" + tarjeta.total + " por " + tarjeta.unidades + " pieza(s)");
  afirmar(tarjeta.unidades === 4, "el servidor contó las 4 piezas: 2 + 1 llaveros y 1 clicker");
  afirmar(Number(tarjeta.total) === 260 + precioClicer,
    "el servidor calculó el total (2 x 100 + 1 x 60 + " + precioClicer + " del clicker)");
  afirmar(tarjeta.columna === "cotizacion", "entró a la columna «Cotización»");

  // Y el desglose tiene que volver de la base: las tres piezas de CADA letra.
  const clicerGuardado = (tarjeta.items || []).filter((it) => it.tipo === "Clicker de Nombre")[0];
  afirmar(!!clicerGuardado && clicerGuardado.detalles.length === letras.length * 3,
    "las 3 piezas de cada una de las " + letras.length + " letras quedaron guardadas (jsonb)");
  afirmar(!!clicerGuardado && clicerGuardado.detalles[0].label === letras[0] + " · Base",
    "cada letra guarda su base con su acabado: «" +
    (clicerGuardado ? clicerGuardado.detalles[0].nombre : "?") + "»");
  afirmar(!!clicerGuardado && clicerGuardado.detalles[2].label === letras[0] + " · Letra",
    "y su letra: «" + (clicerGuardado ? clicerGuardado.detalles[2].nombre : "?") + "»");

  titulo("6) El tablero reparte las tarjetas: cada una en su columna, una sola vez");
  // Esta es la comprobación que atrapa el bug de «la misma tarjeta en las tres
  // columnas»: cada columna pide SÓLO las suyas (Proceso.getTarjetas(columna)).
  const columnas = Proceso.COLUMNAS.map((c) => Proceso.getTarjetas(c.id));
  const total = Proceso.getTarjetas().length;
  afirmar(columnas.reduce((suma, lista) => suma + lista.length, 0) === total,
    "las cuatro columnas suman el tablero entero (" + total + " tarjeta/s)");
  afirmar(columnas.every((lista, i) => lista.every((t) => t.columna === Proceso.COLUMNAS[i].id)),
    "cada columna trae sólo las suyas (ninguna repetida en las cuatro)");
  afirmar(columnas[0].filter((t) => t.id === tarjeta.id).length === 1,
    "la cotización nueva aparece una sola vez, en «Cotización»");

  titulo("7) Mover la tarjeta a «Trabajo» (PATCH /api/cotizaciones/:id)");
  const movida = Proceso.mover(tarjeta.id, "trabajo");
  afirmar(!!movida && movida.columna === "trabajo", "el frontend la movió");
  await esperar(800);
  revisado = await servidor();
  const enTrabajo = revisado.cotizaciones.filter((t) => t.id === tarjeta.id)[0];
  afirmar(!!enTrabajo && enTrabajo.columna === "trabajo", "la columna nueva quedó guardada en la base");
  afirmar(!!enTrabajo && enTrabajo.movidaPor === usuario.nombre,
    "quedó registrado quién la movió (" + (enTrabajo ? enTrabajo.movidaPor : "?") + ")");
  afirmar(Proceso.getTarjetas("cotizacion").every((t) => t.id !== tarjeta.id),
    "ya no está en «Cotización»: se movió, no se copió");

  titulo("8) «Pagado»: se tilda solo al entrar a «Entregado» y se puede destildar");
  // Al entrar a «Entregado» el pago se tilda solo: el frontend lo adelanta para
  // que se vea en el acto y el servidor lo hace igual (es la regla de verdad).
  const entregada = Proceso.mover(tarjeta.id, "entregado");
  afirmar(!!entregada && entregada.columna === "entregado" && entregada.pagado === true,
    "al pasar a «Entregado» el pago se tilda solo");
  await esperar(800);
  revisado = await servidor();
  const pagada = revisado.cotizaciones.filter((t) => t.id === tarjeta.id)[0];
  afirmar(!!pagada && pagada.columna === "entregado" && pagada.pagado === true,
    "la base guardó las dos cosas (la regla no depende del navegador)");

  // Y se puede destildar a mano sin mover la tarjeta (a veces se cobra después).
  afirmar(Proceso.cambiarPagado(tarjeta.id, false), "el frontend lo destildó");
  await esperar(800);
  revisado = await servidor();
  const sinPagar = revisado.cotizaciones.filter((t) => t.id === tarjeta.id)[0];
  afirmar(!!sinPagar && sinPagar.pagado === false && sinPagar.columna === "entregado",
    "quedó sin pagar y en la misma columna");

  titulo("9) Corregir el nombre del cliente (PATCH /api/cotizaciones/:id, sin mover la tarjeta)");
  // La tarjeta es una copia congelada, pero el nombre se corrige: es lo que hace
  // falta cuando el carrito se mandó con un dedazo. No mueve la tarjeta de columna.
  afirmar(Proceso.getTarjeta(tarjeta.id).cliente === "Cliente de prueba",
    "la tarjeta nació con el nombre que mandó el carrito");
  afirmar(Proceso.cambiarCliente(tarjeta.id, "  Cliente Probado  "), "el frontend lo corrigió");
  afirmar(Proceso.getTarjeta(tarjeta.id).cliente === "Cliente Probado",
    "se pinta sin los espacios de sobra");
  await esperar(800);
  revisado = await servidor();
  const renombrada = revisado.cotizaciones.filter((t) => t.id === tarjeta.id)[0];
  afirmar(!!renombrada && renombrada.cliente === "Cliente Probado",
    "el nombre quedó guardado en la base");
  afirmar(!!renombrada && renombrada.columna === "entregado",
    "y la tarjeta no se movió de columna: " + (renombrada ? renombrada.columna : "?"));
  afirmar(Proceso.cambiarCliente(tarjeta.id, "Cliente Probado") === false,
    "el mismo nombre no vuelve a llamar al servidor");

  titulo("10) Quitar la tarjeta del tablero (DELETE /api/cotizaciones/:id)");
  afirmar(Proceso.remove(tarjeta.id), "el frontend la quitó de la vista");
  await esperar(800);
  revisado = await servidor();
  afirmar(!revisado.cotizaciones.some((t) => t.id === tarjeta.id),
    "ya no aparece en el tablero que devuelve la base");
  afirmar(Proceso.getTarjetas().every((t) => t.id !== tarjeta.id),
    "tampoco quedó en ninguna de las cuatro columnas");

  titulo("11) Salir (POST /api/logout)");
  await Api.logout();
  afirmar(!Api.haySesion(), "la sesión se borró del navegador");

  console.log("\n" + (fallas
    ? ("FALLA: " + fallas + " comprobación(es) no pasaron.")
    : "LISTO: el frontend lee y escribe en la base."));
  console.log("  La fila de la cotización del paso 5 quedó en la base con borrada_en marcado");
  console.log("  (el borrado del API es suave, a propósito). Para verla:");
  console.log("    cd api && npm run revisar");

  process.exit(fallas ? 1 : 0);
}

principal().catch(function (error) {
  console.error("\nFALLA: se cortó: " + (error && error.message ? error.message : error));
  console.error("  ¿Está el API levantado en " + BASE + "? Mirá el encabezado de este archivo.");
  process.exit(1);
});
