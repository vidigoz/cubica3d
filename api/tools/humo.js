/* Prueba de humo contra un API que ya está corriendo (local o el desplegado).
 *
 *   npm run humo -- http://localhost:8787 correo@dominio.com "la-clave"
 *   npm run humo -- https://cubica3d.netlify.app correo@dominio.com "la-clave"
 *
 * Recorre el camino completo: salud, login, bootstrap, folio, guardar config,
 * crear la cotización, moverla de columna (hasta «Entregado», con su tilde de
 * pago), sacarla del tablero y cerrar sesión.
 * No ensucia los datos: la configuración se vuelve a guardar tal cual estaba y
 * la cotización de prueba se crea y se borra (queda en la historia, borrada).
 * Lo único que cambia es el contador de folios, que avanza uno. */
const [base, email, clave] = process.argv.slice(2);

if (!base || !email || !clave) {
  console.error('Faltan datos.\n  Uso: npm run humo -- <dirección> <correo> "<contraseña>"');
  process.exit(1);
}

// El mismo origen que está en APP_ORIGEN: así también se prueba el CORS.
// Se puede cambiar con ORIGEN=... (en Netlify el API y el sitio comparten
// dominio, así que el navegador no mandaría CORS; igual se manda, para que la
// prueba valga en cualquier plataforma).
const ORIGEN = process.env.ORIGEN || "http://localhost:8000";
const RAIZ = base.replace(/\/+$/, "");

let pasos = 0;
let fallas = 0;

async function pedir(metodo, camino, opciones) {
  const o = opciones || {};
  const cabeceras = { Origin: ORIGEN };
  if (o.token) cabeceras.Authorization = "Bearer " + o.token;
  if (o.cuerpo) cabeceras["Content-Type"] = "application/json";
  const respuesta = await fetch(RAIZ + camino, {
    method: metodo,
    headers: cabeceras,
    body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined
  });
  const crudo = await respuesta.text();
  let datos = null;
  try { datos = crudo ? JSON.parse(crudo) : null; } catch { datos = crudo; }
  return { estado: respuesta.status, datos };
}

function revisar(titulo, bien, detalle) {
  pasos += 1;
  if (!bien) fallas += 1;
  console.log("  " + (bien ? "ok" : "XX") + "  " + titulo + (detalle ? "   " + detalle : ""));
}

function corto(valor) {
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  return String(texto || "").slice(0, 160);
}

console.log("Prueba de humo contra " + RAIZ);
console.log("");

try {
  /* ------------------------------------------------------------- Sesión */
  const salud = await pedir("GET", "/api");
  revisar("GET /api contesta", salud.estado === 200 && salud.datos && salud.datos.ok === true, corto(salud.datos));

  const acceso = await pedir("POST", "/api/login", { cuerpo: { email: email, password: clave } });
  const token = acceso.datos && acceso.datos.token;
  revisar("POST /api/login da un token", acceso.estado === 200 && !!token,
    token ? "usuario " + ((acceso.datos.usuario || {}).nombre || "?")
          : "estado " + acceso.estado + ": " + corto(acceso.datos));
  if (!token) {
    console.log("");
    console.log("Sin sesión no se puede seguir. Revisá el correo y la contraseña.");
    process.exit(1);
  }

  const sinToken = await pedir("GET", "/api/bootstrap");
  revisar("sin token no deja entrar", sinToken.estado === 401, "estado " + sinToken.estado);

  /* ------------------------------------------------------------ Lectura */
  const arranque = await pedir("GET", "/api/bootstrap", { token: token });
  revisar("GET /api/bootstrap", arranque.estado === 200,
    arranque.datos ? "trae: " + Object.keys(arranque.datos).join(", ") : "estado " + arranque.estado);

  const folio = await pedir("GET", "/api/folio", { token: token });
  const siguiente = folio.datos && folio.datos.siguiente;
  revisar("GET /api/folio", folio.estado === 200 && siguiente > 0, "siguiente " + siguiente);

  /* ---------------------------------------------- Escritura: config */
  // Se guarda EXACTAMENTE lo que ya había: comprueba el permiso de escritura
  // sin cambiarle nada a nadie.
  const config = (arranque.datos && arranque.datos.config) || {};
  const guardado = await pedir("PUT", "/api/config", {
    token: token,
    cuerpo: { colores: config.colores || [], precios: config.precios || {} }
  });
  revisar("PUT /api/config (mismo contenido)", guardado.estado === 200, corto(guardado.datos));

  /* ------------------------------------ Escritura: cotización + kanban */
  const nueva = await pedir("POST", "/api/cotizaciones", {
    token: token,
    cuerpo: {
      clientId: "humo-" + Date.now(),
      meta: {
        fecha: new Date().toISOString().slice(0, 10),
        cliente: "PRUEBA (se puede borrar)",
        notas: "prueba de humo: se crea y se borra sola",
        folio: String(siguiente)
      },
      items: [{
        tipo: "Producto",
        titulo: "Prueba de humo",
        precio: 10,
        cantidad: 2,
        detalles: [{ label: "Base", nombre: "Negro", hex: "#111111" }]
      }]
    }
  });
  const tarjeta = nueva.datos && nueva.datos.cotizacion;
  revisar("POST /api/cotizaciones la guarda", nueva.estado === 200 && !!tarjeta,
    tarjeta ? "folio " + tarjeta.folio + ", total " + tarjeta.total
            : "estado " + nueva.estado + ": " + corto(nueva.datos));
  if (tarjeta) revisar("el folio lo puso el servidor", tarjeta.folio === siguiente, "esperaba " + siguiente);

  if (tarjeta) {
    const movida = await pedir("PATCH", "/api/cotizaciones/" + tarjeta.id, {
      token: token, cuerpo: { columna: "trabajo" }
    });
    revisar("PATCH la mueve a «trabajo»", movida.estado === 200 &&
      movida.datos.cotizacion.columna === "trabajo",
      "columna " + ((movida.datos.cotizacion || {}).columna));

    // La cuarta columna y el tilde de pago: al entrar a «Entregado» el pago se
    // tilda solo (lo decide el servidor) y se puede destildar sin moverla.
    const entregada = await pedir("PATCH", "/api/cotizaciones/" + tarjeta.id, {
      token: token, cuerpo: { columna: "entregado" }
    });
    revisar("PATCH la mueve a «entregado» y tilda el pago solo", entregada.estado === 200 &&
      entregada.datos.cotizacion.columna === "entregado" && entregada.datos.cotizacion.pagado === true,
      "columna " + ((entregada.datos.cotizacion || {}).columna) +
      ", pagado " + ((entregada.datos.cotizacion || {}).pagado));

    const destildada = await pedir("PATCH", "/api/cotizaciones/" + tarjeta.id, {
      token: token, cuerpo: { pagado: false }
    });
    revisar("el tilde se destilda sin mover la tarjeta", destildada.estado === 200 &&
      destildada.datos.cotizacion.pagado === false && destildada.datos.cotizacion.columna === "entregado",
      "columna " + ((destildada.datos.cotizacion || {}).columna) +
      ", pagado " + ((destildada.datos.cotizacion || {}).pagado));

    const tablero = await pedir("GET", "/api/tablero", { token: token });
    revisar("GET /api/tablero la muestra", tablero.estado === 200 &&
      JSON.stringify(tablero.datos || {}).includes(tarjeta.id));

    const borrada = await pedir("DELETE", "/api/cotizaciones/" + tarjeta.id, { token: token });
    revisar("DELETE la saca del tablero", borrada.estado === 200);

    const despues = await pedir("GET", "/api/tablero", { token: token });
    revisar("ya no aparece en el tablero", !JSON.stringify(despues.datos || {}).includes(tarjeta.id));
  }

  /* ------------------------------------------------------------- Salida */
  const salida = await pedir("POST", "/api/logout", { token: token });
  revisar("POST /api/logout", salida.estado === 200);

  const vencido = await pedir("GET", "/api/bootstrap", { token: token });
  revisar("el token queda invalidado", vencido.estado === 401, "estado " + vencido.estado);
} catch (error) {
  console.log("");
  console.log("No pude hablar con " + RAIZ + ": " + (error.message || error));
  console.log("Si es local, ¿está corriendo `npm run server` en otra terminal?");
  process.exit(1);
}

console.log("");
console.log(fallas
  ? "Fallaron " + fallas + " de " + pasos + " comprobaciones."
  : "Todo bien: " + pasos + " comprobaciones pasaron.");
process.exit(fallas ? 1 : 0);

