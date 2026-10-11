# Cubica3D

**Cubica3D** es un cotizador para productos de impresión 3D, hecho con **HTML + CSS + JavaScript vanilla**,
sin dependencias ni build.

## Cómo usarlo

**Opción 1 — Doble clic:** abre `index.html` en tu navegador.

**Opción 2 — Servidor local** (recomendado si vas a desplegarlo):

```bash
cd "Proyecto 3D/cotizador"
python3 -m http.server 8000
```

Luego entra a <http://localhost:8000>.

**Opción 3 — Todo junto, como en producción** (recomendado si vas a tocar el API): `netlify dev`
levanta el sitio *y* el API en el mismo puerto, leyendo la cadena de conexión del `.env` de la raíz
(el mismo archivo que `api/.env`, ver **[`api/README.md`](api/README.md)**):

```bash
npx netlify dev                   # http://localhost:8888 (sitio) y http://localhost:8888/api (API)
```

## Marca y logo

La app se llama **Cubica3D** y su logo se usa en tres lugares: el encabezado (`.app-header__logo-img`),
el favicon de la pestaña y la cabecera de la cotización en PDF (vía `NEGOCIO.logo`). En `icons/` hay
dos archivos:

| Archivo | Para qué sirve |
|---|---|
| `icons/cubica.png` | **Maestro**: el PNG original del diseñador (1254×1254, fondo blanco, ~1 MB). La app **no** lo carga; es la fuente para rehacer el optimizado. |
| `icons/cubica-logo.png` | **El que usa la app**: el mismo logo recortado, sin fondo blanco y a 320 px (~89 KB), para que el PDF de cada cotización pese kilobytes en vez de ~1 MB. |

### Rehacer el logo optimizado

Si cambias el maestro `icons/cubica.png`, regenera el optimizado con la herramienta que viene incluida:

```bash
python3 -m http.server 8000        # desde la carpeta del proyecto
```

Abre <http://localhost:8000/tools/logo.html> y pulsa **Descargar**; guarda el archivo como
`icons/cubica-logo.png` (reemplaza al existente). La herramienta le quita el fondo blanco, recorta los
márgenes y lo deja a 320 px, así el cubo llena la placa del encabezado y la cabecera del PDF.
(El navegador no deja leer archivos locales con `file://`, de ahí el servidor.)

Para usar otro logo con otro nombre de archivo, actualiza la ruta en `index.html` (favicon y
encabezado) y en `js/pdf.js` (`NEGOCIO.logo`).

## Pestañas y rutas

- **Productos** (`#/productos`) — menú principal de productos + carrito de cotización.
  - Formulario de un producto: `#/productos/llaveros`.
  - **Desglose + PDF**: `#/carrito`.
- **Proceso** (`#/proceso`) — tablero Kanban de las cotizaciones enviadas.
- **Configuración** (`#/configuracion`) — la abre el **engranaje ⚙** del encabezado; ajusta colores en stock y precios.

Rutas viejas: `#/cotizacion` y `#/trabajos` siguen funcionando como alias de `#/productos` y
`#/proceso`, para que los enlaces guardados no se rompan.

El chip **🛒 0 · $0.00** del encabezado muestra el carrito en cualquier pestaña: el número son las
**piezas** (no las líneas) y al pulsarlo abre el desglose (`#/carrito`), que vive dentro del flujo
de Productos, así que esa pestaña sigue activa.

## Productos

| Producto | Estado |
|---|---|
| **Llaveros de Nombre** | ✅ Funcional |
| **Clicker de Nombre** | 🔜 Próximamente |

### Producto "Llaveros de Nombre"

- Campo **Nombre** (obligatorio) y **Apellido** (opcional).
- Menús de **Color de Base** y **Color del Nombre** (se llenan con los colores en stock).
- El precio se calcula solo:
  - Solo nombre → precio *Nombre*.
  - Con apellido → precio *Nombre + Apellido*.
- Botón **Agregar al carrito** → se suma al carrito compartido con su **precio unitario**
  (entra con **cantidad 1**; luego la ajustas en el desglose).
- Botón **Ver desglose** → abre `#/carrito` para capturar los datos y exportar el PDF.
- Botón **← Volver al menú** para regresar a la página de productos.

## Carrito de cotización

- Es **compartido entre productos**: sales del formulario de un producto y vuelves al menú
  sin perder lo agregado; al agregar otro producto, **se suma al mismo carrito**.
- Cada línea guarda su **cantidad** (mínimo 1) y su **precio unitario**; el importe se calcula
  como precio × cantidad.
- **Limpiar** vacía todo el carrito y arranca una cotización nueva (avanza el folio y borra los
  datos del cliente).
- Se **guarda en el `localStorage`** (clave `cotizador.carrito.v1`), así que sobrevive al recargar.

## Desglose y PDF (`#/carrito`)

- Tabla con **#, producto, detalle (colores), cantidad, precio unitario e importe**, más los
  botones **+/−** para ajustar cantidades y **✕** para quitar líneas.
- **Datos de la cotización:** folio, fecha, cliente y notas. Se guardan solos mientras escribes
  y se ven al instante en la vista previa.
- **Vista previa A4** de la hoja tal como saldrá impresa.
- **Exportar PDF** abre el diálogo de impresión del navegador: elige **Guardar como PDF**.
  El nombre del archivo se arma solo a partir del folio y el cliente
  (ej. `Cotizacion-0012-Maria-Lopez.pdf`).
- **Enviar al tablero** guarda la cotización en **Proceso** (primera columna), vacía el carrito y
  adelanta el folio al siguiente libre, así que la cotización enviada ya no se puede editar por
  accidente. El botón se desactiva si el carrito está vacío.

### Personalizar la plantilla

Todo el diseño del documento vive en **`js/pdf.js`**: la misma función `documento()` dibuja la
vista previa en pantalla y el PDF, así que al editarla cambian las dos. Para replicar otro
template basta con ajustar el objeto `NEGOCIO` (nombre, logo, contacto, vigencia, pie):

```js
var NEGOCIO = {
  nombre: 'Cubica3D',
  slogan: 'Cotizador de impresión 3D',
  logo: 'icons/cubica-logo.png',                 // null = insignia con el texto "3D"
  contacto: ['WhatsApp 55 1234 5678'],           // ej. datos de contacto
  vigencia: '15 días naturales',
  pie: 'Gracias por tu preferencia.'
};
```

El resto de la app no sabe nada del diseño: sólo llama a `window.PDF.documento()` e
`window.PDF.imprimir()`.

## Proceso (`#/proceso`)

Tablero **Kanban** con tres columnas, que son el flujo de trabajo: **Cotización → Trabajo → Realizado**.

- Cada tarjeta es una **copia congelada** de la cotización tal como se envió (folio, cliente, notas,
  líneas, unidades y total). Editar el carrito después **no** cambia nada de lo guardado: aquí vive
  el historial de lo que ya se le mandó al cliente.
- Cada tarjeta trae sus propios botones para moverse: **← Atrás** y **Adelante →**, que además dicen
  el nombre de la columna a la que van y se desactivan cuando ya no hay a dónde moverse. No hay
  arrastrar y soltar: con el dedo el gesto se confundía con el scroll de la página. Al cambiar de
  columna la tarjeta entra **arriba** de la suya y se sella la fecha del movimiento.
- **Ver** abre la **cotización completa en pantalla**: la misma hoja A4 que se le envió al cliente,
  sin generar ni descargar nada (útil para enseñarla en el mostrador o compartir pantalla). Desde
  ahí, **🖨️ Descargar PDF** la saca en PDF y **Cerrar** (o **Esc**) vuelve al tablero.
- **Ver detalle** despliega las líneas de la cotización y **🖨 PDF** reimprime esa hoja tal como se
  envió (mismo diseño que la vista previa del carrito).
- **Quitar** borra la tarjeta, con confirmación.
- Todo se guarda en el `localStorage` (clave `cotizador.proceso.v1`); el chip de cada pestaña del
  tablero muestra cuántas tarjetas tiene.
- El contador de folios del carrito se sincroniza con el tablero (`Proceso.siguienteFolio()`), así
  que reiniciar el carrito nunca repite un folio ya enviado.

## Configuración

- **Colores en stock:** agrega (nombre + selector de color) y quita colores. Los cambios se ven al instante en los menús de la cotización.
- **Precios:** edita el precio de *Solo nombre* y de *Nombre + Apellido*.
- **Restaurar valores por defecto.** Vuelve a Negro, Blanco y Rojo, y a $60 / $100.

Todo se guarda en el `localStorage` del navegador (clave `cotizador.config.v1`).

## Datos compartidos (Neon)

La configuración, las cotizaciones enviadas y las posiciones del tablero van a vivir en un
**Postgres de Neon**, para que todo el equipo vea lo mismo y nada dependa de en qué navegador
se abrió. El API está en `api/`, se publica como **función de Netlify** (mismo dominio que el
sitio, así que no hay CORS) y la cadena de conexión con la base vive en las variables de entorno
del sitio, nunca en el navegador. Su documentación completa —puesta en marcha, despliegue,
pruebas y migración— está en **[`api/README.md`](api/README.md)**.

| Qué | Hoy (navegador) | Después (Neon) |
|---|---|---|
| Colores en stock y precios | `localStorage` | tabla `configuracion` |
| Cotizaciones enviadas + tablero | `localStorage` | `cotizaciones` + `cotizacion_items` |
| Folio | `Proceso.siguienteFolio()`, calculado en el navegador | `siguiente_folio()`, en la base |
| Carrito en armado | `localStorage` | **sigue igual**: es un borrador personal |

- **El folio lo entrega la base**, no el navegador: dos personas cotizando a la vez no pueden
  repetirlo (hoy sí pueden, porque cada navegador cuenta por su cuenta).
- **El total y las unidades los recalcula el servidor** al guardar la cotización.
- **Entrar requiere usuario y contraseña** (`npm run usuario` los crea). Cada tarjeta queda
  sellada con quién la envió y quién la movió, y hay una **bitácora** de cada movimiento.
- **"Quitar" es un borrado suave**: la tarjeta sale del tablero pero sus datos quedan
  guardados, así se puede reportar sobre lo vendido o deshacer un error.
- **La cadena de conexión a la base nunca llega al navegador**: el frontend sólo habla con el
  API.

> **Estado:** el API está publicado en Netlify (`https://cubica3d.netlify.app/api`), habla con el
> Postgres de Neon usando la cadena de conexión de las variables del sitio, y la prueba de humo
> completa pasa 14/14 tanto contra producción como en local con `npx netlify dev` leyendo el `.env`
> de la raíz. La base quedó limpia (sólo tu usuario, sin cotizaciones de prueba). Falta conectar el
> frontend al API —hoy sigue leyendo del `localStorage`— y migrar lo ya cargado
> (`tools/respaldo-localstorage.js` + `npm run migrar`): es el paso siguiente.

## Estructura

```
cotizador/
├── index.html
├── css/styles.css
├── netlify.toml                 # cómo publica Netlify: el sitio de la raíz + la función `api`
├── netlify/functions/api.mjs    # envuelto de Netlify: le pasa la petición a api/functions/api.js
├── package.json                 # `pg`, la dependencia que usa la función desplegada
├── db/
│   └── schema.sql               # esquema de la base compartida (Neon), en un solo archivo
├── api/                         # el API que reemplaza el localStorage compartido
│   ├── neon.ts                  # (alternativa) declara la función para el CLI de Neon
│   ├── functions/api.js         # login + configuración + cotizaciones (autocontenido)
│   ├── tools/                   # schema, usuario, migrar, revisar, servidor local y humo
│   └── README.md                # puesta en marcha, deploy, pruebas y migración
├── icons/
│   ├── cubica.png              # logo maestro (original del diseñador)
│   └── cubica-logo.png         # logo optimizado: encabezado, favicon y PDF
├── tools/
│   ├── logo.html + logo.js     # regenera icons/cubica-logo.png desde el maestro
│   └── respaldo-localstorage.js # baja un JSON con lo guardado en este navegador
└── js/
    ├── utils.js                # helpers: uuid, moneda, escape
    ├── store.js                # configuración persistente (localStorage)
    ├── cart.js                 # carrito + datos de la cotización (localStorage)
    ├── proceso.js              # tablero Kanban: tarjetas congeladas (localStorage)
    ├── pdf.js                  # plantilla A4 de la cotización + visor en pantalla + impresión/PDF
    ├── views/
    │   ├── productos.js        # menú de productos + formulario Llaveros + carrito
    │   ├── carrito.js          # desglose: cantidades, datos, vista previa A4 y envío al tablero
    │   ├── proceso.js          # tablero Kanban: columnas, tarjetas y botones ← / →
    │   └── configuracion.js    # colores + precios
    └── app.js                  # pestañas, enrutado por hash, chip del carrito y avisos
```

## Notas técnicas

- Se usan **scripts clásicos** (no ES modules) para que funcione abriendo el archivo con `file://`.
- El API vive aparte, en `api/`, con su propio `package.json` (Node) y un envuelto de seis líneas
  en `netlify/functions/api.mjs` para publicarlo junto al sitio: el frontend **no** ganó
  dependencias ni pasos de armado. Abrir `index.html` con doble clic sigue funcionando igual.
- Orden de carga en `index.html`: `utils` → `store` → `cart` → `proceso` → `pdf` → `views` → `app`.
- El enrutador soporta sub-rutas (`#/productos/llaveros`), así el botón **atrás** del navegador
  funciona; `ALIASES` traduce las rutas viejas (`cotizacion`, `trabajos`) a las nuevas.
- `Cart.setMeta()` **no** avisa a los suscriptores a propósito: son datos de cabecera, no líneas del
  carrito, y notificar repintaría la vista justo mientras el usuario escribe.
- El PDF se genera con la impresión nativa del navegador (`window.print()` + reglas `@media print`),
  sin librerías: no hay PDFs "de mentira", es el mismo HTML de la vista previa.
- `PDF.imprimir({ meta, items })` dibuja la hoja dentro de `#print-root` (fuera del lienzo en
  pantalla) y marca `body.app-print`: el CSS de impresión oculta todo lo demás, así el PDF sale igual
  desde el carrito o desde una tarjeta del tablero. Al cerrar el diálogo se borra esa hoja y se
  restaura el `<title>`, que durante la impresión es el nombre sugerido del archivo.
  Si en cambio se imprime con **Ctrl+P**, se usa la vista previa visible del carrito.
- `PDF.ver({ meta, items })` abre esa misma hoja dentro de un `<dialog>` a modo de visor: se encoge
  con `transform: scale()` (el cálculo vive en `ajustarVisor`) para entrar entera en la ventana, así
  que en el móvil se ve completa —para leerla se gira el teléfono o se pellizca—. El visor cuelga del
  `<body>`, no de la vista, para que el repintado del tablero no se lo lleve por delante, y
  `@media print` lo oculta: imprimir desde dentro del visor sigue sacando la hoja de `#print-root`.
  Si el navegador no soporta `<dialog>`, `PDF.ver` cae en `PDF.imprimir`.
