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

**Opción 4 — Todo junto y con la base adentro del proyecto** (sin Neon, sin `netlify dev`): el
servidor propio sirve el sitio *y* el API en un solo puerto, y guarda en `api/datos/`:

```bash
npm run local                     # desde la raíz: http://localhost:8787 (sitio + API)
# es lo mismo que:  cd api && npm run server
```

Los demás puestos del taller entran por `http://<IP-de-esta-PC>:8787`. Qué base usa, cómo
respaldarla y por qué no se puede desplegar: **[`api/README.md`](api/README.md)**.

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
  - Formulario de un producto: `#/productos/llaveros` y `#/productos/clicers`.
  - **Desglose + PDF**: `#/carrito`.
- **Proceso** (`#/proceso`) — tablero Kanban de las cotizaciones enviadas.
- **Configuración** (`#/configuracion`) — la abre el **engranaje ⚙** del encabezado; ajusta colores en stock y precios.

En **Proceso**, la tarjeta que pasa a una columna entra **abajo**, salvo en **Entregado**: ahí la que
acaba de entregarse va **primera** y empuja a las demás hacia abajo.

Rutas viejas: `#/cotizacion` y `#/trabajos` siguen funcionando como alias de `#/productos` y
`#/proceso`, para que los enlaces guardados no se rompan.

El chip **🛒 0 · $0.00** del encabezado muestra el carrito en cualquier pestaña: el número son las
**piezas** (no las líneas) y al pulsarlo abre el desglose (`#/carrito`), que vive dentro del flujo
de Productos, así que esa pestaña sigue activa.

## Productos

| Producto | Estado |
|---|---|
| **Llaveros de Nombre** | ✅ Funcional |
| **Clicker de Nombre** | ✅ Funcional |

### Producto "Llaveros de Nombre"

- Campo **Nombre** (obligatorio) y **Apellido** (opcional).
- Menús de **Color de Base** y **Color del Nombre** (se llenan con los colores en stock).
- El precio se calcula solo:
  - Solo nombre → precio *Nombre*.
  - Con apellido → precio *Nombre + Apellido*.
- Botón **Agregar al carrito** → se suma al carrito compartido con su **precio unitario**
  (entra con **cantidad 1**; luego la ajustas en el desglose).
- Botón **Siguiente →** → abre `#/carrito` para capturar los datos y exportar el PDF.
- Botón **← Volver al menú** para regresar a la página de productos.
- **Editar una cotización ya enviada:** el botón **Editar** de su tarjeta en Proceso la carga en el carrito y regresa a Productos para agregar o quitar lo que haga falta; con **Siguiente → Guardar cambios** la tarjeta queda actualizada (mismo folio y misma columna). El carrito que tenías en armado se guarda aparte y vuelve al terminar o cancelar.
- **Editar un producto de la lista:** en el carrito (también al editar una tarjeta) cada línea trae un ✏️ que abre el formulario de ese producto ya lleno —nombre, colores letra por letra, desglose—; con **Guardar línea** se reemplaza en el mismo lugar y con la misma cantidad. El precio del clicker y del llavero se recalcula con los precios actuales de Configuración. Un clicker de los primeros tiempos, sin receta por letra, no se puede reconstruir: se quita y se agrega de nuevo.

### Producto "Charm para Silla"

- Escribes el nombre o texto (letras, números, símbolos y **emojis**: «Alejandro Perez #11»; en la PC el
  botón **😀** abre el selector). Cada letra, número, símbolo o emoji es una **pieza bicolor** —una **base** de un color y una **tapa** de otro—; los espacios no
  cuentan.
- Los menús **Base · Color de todas** y **Tapa · Color de todas** ponen el texto entero igual; abajo hay una
  fila por pieza para cambiar una sola.
- **+ Agregar charm** suma charms sueltos («pelota de volly»), todos los que quieras.
- Precio **fijo** de $350, sin importar las piezas ni los charms; se cambia en **Configuración → Precios**.
- En **Estadísticas** cuenta una tarjeta de **Bases del charm** y otra de **Tapas del charm**, con sus colores.

### Producto "Clicker de Nombre"

Cada **letra** del nombre —y cada **emoji**, que es una más— lleva **tres piezas**: la
**base** (color + acabado **Corrugado** o **Liso**), la **tecla** y la **letra** impresa. Las tres se
eligen de los colores en stock y se pueden poner **iguales para todo el nombre** o **letra por letra**.

- Campo **Nombre** (obligatorio): una sola palabra, sólo letras (acentos y Ñ incluidos) y **emojis**.
  Con cada letra que escribes aparece **una fila nueva** debajo (base + acabado + tecla + letra de esa
  letra), así se ve enseguida en cuántas se va. Un **emoji cuenta como una letra más**: lleva sus tres
  piezas y paga el mismo precio por letra. En el celular se escribe con el teclado de emojis; en la
  computadora, el botón **😀** junto al campo abre un selector.
- Ya **no hay campo Símbolo**: una estrella, un corazón o un logo se ponen como **emoji** directamente
  en el nombre. Los clickers viejos que traían el símbolo escrito aparte («ANA + estrella») se siguen
  viendo y cotizando igual, pero no se pueden reabrir con ✏️: se quitan y se agregan de nuevo.
- **Menús «de todas»** (arriba): *Base · Acabado de todas*, *Base · Color de todas*,
  *Tecla · Color de todas* y *Letra · Color de todas*. Con eso queda el nombre entero igual de una
  vez; al mover cualquiera de los cuatro, todas las letras vuelven a seguir ese menú.
- **Letra por letra** (abajo): cada fila tiene los cuatro menús de su letra, así se cambia sólo la
  que quieras sin tocar las demás. Lo elegido se conserva al seguir escribiendo el nombre (y se
  recorta si borras letras). La muestra de color se actualiza al instante.
- **Precio por letra** —un emoji cuenta como **una letra más**—, con dos tramos (se configuran en
  *Configuración → Precios*, ver abajo):
  - Hasta *N* letras (por defecto **5**) → precio **por letra corto**.
  - De *N+1* letras en adelante → precio **por letra largo**.
  - Debajo del precio se ve la cuenta (`6 letras × $30.00 (precio de 6 letras o más)`).
- Botón **Agregar al carrito** → entra con **cantidad 1** y un **desglose completo** (por cada letra
  —y el símbolo—: `A · Base`, `A · Tecla`, `A · Letra`, `estrella · Base`…, cada pieza con su color y
  la base con su acabado), que es lo que viaja al carrito, al PDF y al tablero: con eso se fabrica sin
  tener que preguntar nada. En la **orden de producción** un emoji aparece como su propia forma
  (`⭐ ×1`) dentro de su tanda, así el taller sabe que tiene que imprimir esa pieza.

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
- Al **enviar** la cotización eliges **PDF** o **PNG** y se descarga solo. El nombre del archivo se
  arma a partir del folio y el cliente (ej. `Cotizacion-0012-Maria-Lopez.pdf`).
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

Tablero **Kanban** con cinco columnas, que son el flujo de trabajo: **Cotización → Confirmado →
Trabajo → Realizado → Entregado**. Una cotización nueva entra a **Cotización**; **Confirmado** es
la venta que el cliente ya aceptó, antes de pasarla al taller (el botón **PO** ya sale desde ahí; el
**Ensamble**, desde **Trabajo**).

- Cada tarjeta es una **copia congelada** de la cotización tal como se envió (folio, cliente, notas,
  líneas, unidades y total). Editar el carrito después **no** cambia nada de lo guardado: aquí vive
  el historial de lo que ya se le mandó al cliente.
- El **nombre del cliente** se corrige desde la propia tarjeta: se toca el nombre —se subraya al
  pasar el mouse—, se escribe y se guarda con **Enter** o al salir del campo; **Esc** deja el de
  antes. Es para arreglar un dedazo del carrito sin borrar y volver a enviar la cotización, que ya
  es una copia congelada: **no** mueve la tarjeta de columna. Dejar el campo vacío guarda la tarjeta
  **sin cliente**, como las que se envían sin nombre. El cambio mueve el sello de la tarjeta (igual
  que el tilde de **Pagado**), así que las otras pantallas abiertas lo ven en unos segundos.
- Cada columna tiene un selector de **orden**: **manual** (el de siempre, el del arrastre), **fecha**
  (la cotización más vieja arriba) o **precio** (el total más alto arriba, ya con el descuento). Es sólo
  una forma de verla: no cambia el orden guardado, así que al volver a **manual** regresa el que
  acomodaste a mano. Cada persona deja el suyo en su navegador, por columna. En una columna ordenada
  no se arrastra (sí se puede mover con los botones y soltar una tarjeta en ella desde otra columna).
- Cada tarjeta se **arrastra** a su lugar: con el **mouse** se agarra al mover un poco y se suelta
  donde va; con el **dedo** hay que **mantenerla pulsada** un momento y recién ahí arrastrar (si el
  dedo se mueve antes, el gesto es el scroll de la página de siempre: por eso el tablero estuvo un
  tiempo sin arrastre). Mientras la llevás, la tarjeta flota bajo el puntero, en su lugar queda un
  **hueco punteado** que dice dónde va a caer y la columna destino se resalta; **Esc** (o soltarla
  fuera del tablero) cancela y la deja como estaba. También están los botones **← Atrás** y
  **Adelante →**, que dicen el nombre de la columna a la que van, se desactivan cuando ya no hay a
  dónde moverse y siguen siendo lo más cómodo con el teclado o para mover de a un paso.
- **El orden de cada columna es el de llegada**: lo que entra por un cambio de columna se suma
  **abajo** (los trabajos viejos quedan arriba y los nuevos abajo) y la **cotización recién enviada**
  entra **arriba** de «Cotización», que es la que hay que ver enseguida. Arrastrar cambia ese orden
  cuando haga falta: la tarjeta queda guardada en el hueco donde la soltaron —la posición es el punto
  medio entre sus vecinas, así que nunca se renumera la columna— y se sella la fecha del movimiento.
- Cada tarjeta trae un tilde **Pagado** (debajo del importe) que en **Entregado** se **tilda solo**
  —entregado se da por cobrado— y se puede destildar a mano cuando el cobro queda para después. En
  las otras columnas también se puede marcar, para el cliente que paga por adelantado. Marcar o
  destildar **no mueve la tarjeta**: sólo la marca (**Pagado** en verde) para ver de un vistazo qué
  falta cobrar.
- **Ver** abre la **cotización completa en pantalla**: la misma hoja A4 que se le envió al cliente,
  sin generar ni descargar nada (útil para enseñarla en el mostrador o compartir pantalla). Desde
  ahí, **🖨️ Descargar PDF** la saca en PDF y **Cerrar** (o **Esc**) vuelve al tablero.
- **PO** aparece en cuanto la tarjeta sale de **Cotización** (o sea, cuando ya hay algo que
  fabricar) y abre la **orden de producción**: otra hoja A4, sin precios, con lo que hay que hacer,
  agrupado por **tandas de producción** (las cuentas las hace `js/po.js`):
  - las **bases del clicker** se juntan por color y acabado, y cada tanda dice qué letras lleva;
  - las **teclas con su letra** se juntan por el **par ordenado** tecla → letra: una tecla roja con
    letra blanca no es la misma tanda que una tecla blanca con letra roja;
  - los **llaveros**, por la combinación ordenada cuerpo → nombre impreso, con los nombres adentro;
  - y abajo, los **materiales por color** (cuántas piezas de cada color hay que imprimir).
  La tarjeta muestra el resumen en corto (**18 bases · 18 teclas + 18 letras · 3 llaveros ·
  5 grupos**) para no tener que abrir la hoja. Lo que no se agrupa solo (una cotización vieja de
  clicker, o cualquier otro producto) cae en **Otros productos** por su combinación de colores:
  la orden nunca deja una línea afuera.
- **Ensamble** aparece en las tarjetas que traen clickers, desde **Trabajo** en adelante (es la receta
  que se consulta mientras se arma, no cuando recién se cotiza), y abre la **receta de
  armado** en pantalla (no se imprime): una tabla de **cinco columnas** —**letra**, **color de base**,
  **estilo de base**, **color tecla** y **color de letra**— con **una fila por letra, en el orden del
  nombre**, y el símbolo escrito a mano al final, marcado como símbolo. La receta es de **un clicker**
  (el encabezado dice cuántos son), así que con 3 clickers las letras no se repiten tres veces. Los
  llaveros, que no tienen letras, van en su propio bloque en corto (cuerpo y nombre impreso, con los
  nombres que van adentro). Se cierra con **Esc**, con un clic afuera o con su botón, y no queda nada
  colgado cuando se cierra.
- **Ver detalle** despliega lo que hay que fabricar, y cambia según la columna en la que esté la
  tarjeta: en **Cotización** son sólo los **nombres** de la venta (**1× Allison**, **1× Ana**), sin
  colores, porque ahí todavía no se fabricó nada (el detalle con todos los colores sigue en **Ver** y
  en el PDF); de **Trabajo** en adelante se le suman los **lotes del taller** —los mismos de la PO,
  en corto: la cantidad, el color y el acabado de cada tanda de bases con las letras que lleva,
  las teclas con su letra, los llaveros y **Otros productos**, y al pie el total de piezas—.
  Las dos secciones que el taller imprime **de a tandas** —**Bases del clicker** y **Teclas con su
  letra**— llevan su **casilla** delante del rótulo (se puede tocar el rótulo entero): al tildarla, la
  sección y su tanda quedan **en verde y atenuadas**, para ver de un vistazo qué se imprimió y qué
  falta. El tilde es **de la tarjeta**: se guarda en la base, lo ve todo el equipo, **no mueve la
  tarjeta** de columna y **no sale en la hoja ni en el PDF** (los llaveros y otros productos, que se
  imprimen de a uno por nombre, no lo llevan).
  **🖨 PDF** reimprime esa hoja tal como se envió (mismo diseño que la vista previa del carrito).
- **Quitar** borra la tarjeta, con confirmación.
- Todo se guarda en **Postgres** (ver *Datos compartidos*): la tarjeta, su columna y su lugar en la
  columna (`cotizaciones.posicion`), así que el tablero se ve igual desde cualquier equipo. El chip
  de cada pestaña del tablero muestra cuántas tarjetas tiene.
- El contador de folios del carrito se sincroniza con el tablero (`Proceso.siguienteFolio()`), así
  que reiniciar el carrito nunca repite un folio ya enviado.

## Configuración

- **Colores en stock:** agrega (nombre + selector de color) y quita colores. Los cambios se ven al instante en los menús de la cotización.
- **Precios:**
  - *Llavero · Solo nombre* y *Llavero · Nombre + Apellido*.
  - *Clicker · Precio por letra (hasta N letras)*, *Clicker · Precio por letra (N+1 letras o más)* y
    *Clicker · El precio corto aplica hasta (letras)* (por defecto **5**). Al lado hay un ejemplo con
    el precio ya calculado, así se ve el efecto del corte sin tener que cotizar.
- **Restaurar valores por defecto.** Vuelve a Negro, Blanco y Rojo, y a $60 / $100 y al clicker
  $15 / $30 por letra con corte en 5.

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
- **La app entra sola, sin login** (`POST /api/acceso`, ver *La app entra sola*): las tarjetas quedan
  selladas con la cuenta del taller y hay una **bitácora** de cada movimiento. Las cuentas siguen
  existiendo (`npm run usuario` las crea) para cerrar el acceso o para el API.
- **Poner al día una base que ya estaba andando** (por ejemplo, la cuarta columna, el tilde de
  **Pagado** y los tildes del taller de la tarjeta): volver a aplicar el mismo esquema,
  `cd api && npm run schema`. Es idempotente —se puede
  correr las veces que haga falta— y no borra ni pisa datos: agrega lo que falta y rehace el `check` de
  las columnas para que acepte **Entregado**. Si la base es la de Neon (la del sitio desplegado), el
  momento es **antes** de subir el cambio que usa esos campos, no después: el API que se publica lee
  `pagado` y los tildes del taller, así que una base que todavía no los tiene contesta error.
  Aplicarlo primero no rompe nada,
  porque todo lo que agrega es opcional para el código que ya estaba andando.
- **"Quitar" es un borrado suave**: la tarjeta sale del tablero pero sus datos quedan
  guardados, así se puede reportar sobre lo vendido o deshacer un error.
- **La cadena de conexión a la base nunca llega al navegador**: el frontend sólo habla con el
  API.

### Base local (sin Neon)

Si preferís que los datos **no salgan de tu máquina** —o no depender de internet— el proyecto trae
su propia base: Postgres (PGlite, el motor compilado a WebAssembly) guardado en `api/datos/`, con el
**mismo `db/schema.sql`** que usa Neon. Se elige con una variable en `api/.env`:

| En `api/.env` | Base que se usa |
|---|---|
| `BASE_LOCAL="true"` (o una ruta) | **la local** (`api/datos/`), aunque haya `DATABASE_URL` |
| sin `BASE_LOCAL`, con `DATABASE_URL` | **Neon** |
| sin ninguna de las dos | **la local** |

Con `npm run local` (o `cd api && npm run server`) el sitio y el API salen del mismo puerto, así que
no hacen falta CORS ni un segundo servidor de archivos. Para ver cómo va y para respaldarla:
`cd api && npm run base-local`, y la copia de seguridad con `npm run base-local -- --respaldo`.

**Lo que no se puede: poner esa base en Netlify.** En una función el disco es efímero (se borra al
terminar cada instancia, y cada copia de la función vería datos distintos), así que la base local es
para la PC del taller, que sirve a las demás. El sitio desplegado necesita una base de verdad
(Neon). Si querés que el sitio de Netlify use los datos de tu máquina, hay que dejar esa PC
encendida con `npm run local`, exponerla con un túnel HTTPS (Cloudflare Tunnel, Tailscale Funnel o
ngrok) y apuntar el frontend ahí con `window.CUBICA_API="https://tu-tunel/api"`; el navegador no
puede llamar a `http://192.168.x.x:8787` desde una página `https://`.

### La app entra sola (sin pantalla de login)

**No hay login y no hay contraseña que escribir**: al abrirse, la app le pide una sesión al API
(`POST /api/acceso`) y el servidor se la da con la **cuenta del taller** —la de `ACCESO_EMAIL` en
`api/.env` o, si esa no está, la primera cuenta activa de la base—. El token sigue existiendo (cada
pedido va firmado y cada tarjeta queda sellada con quién la hizo), lo que se sacó es el formulario.

La cuenta se deja lista sola: `npm run local` la crea o la actualiza al arrancar, y si la base está
recién creada inventa una (`taller@cubica3d.local`) para que el cotizador abra igual en una máquina
nueva. `ACCESO_CLAVE` en `api/.env` sirve sólo para crearla (en Postgres queda su hash scrypt) y
`cd api && npm run acceso` la vuelve a dejar al día si cambiás el correo, el nombre o la clave.

Si algo impide entrar (servidor apagado, base sin cuentas), la app muestra un aviso con el motivo y
un botón **Reintentar**; nunca pide credenciales.

**El PIN (opcional):** con `PIN="3008"` en `api/.env` —o en las variables del sitio— la página queda
cerrada con llave. Al abrirla aparece un **pinpad** y al **cuarto dígito** se verifica solo: no hay
botón de entrar ni campo de contraseña. Con PIN puesto, `/api/acceso` ya no entrega sesión (contesta
`{ automatico: false, pin: true }`), así que la única puerta es `POST /api/pin`, y el servidor abre la
misma sesión de treinta días de siempre. Son 10.000 números: **es una llave, no una contraseña**
(los intentos fallidos se cuentan de a 5 cada 15 minutos por instancia). Si la variable tiene otra cosa
que no sean 4 dígitos, el cotizador no se abre y lo dice en pantalla; sin la variable, entra sola como
antes.

> **Ojo con el sitio desplegado:** el `.env` es sólo para tu máquina; en Netlify estas variables van
> en *Site configuration → Environment variables*. Y como el acceso ya no pide nada, **cualquiera
> que tenga el enlace del sitio entra** (salvo que pongas el `PIN`): para cerrarlo del todo,
> `ACCESO_LIBRE="false"`. Ahí `/api/acceso` no
> entrega sesión y la única puerta es `POST /api/login` (correo + contraseña), pensada para
> herramientas y scripts.

> **Estado:** el API está publicado en Netlify (`https://cubica3d.netlify.app/api`), habla con el
> Postgres de Neon usando la cadena de conexión de las variables del sitio, y la prueba de humo
> completa pasa 14/14 tanto contra producción como en local con `npx netlify dev` leyendo el `.env`
> de la raíz. La base quedó limpia (sólo tu usuario, sin cotizaciones de prueba). El frontend **ya
> habla con el API** en vez del `localStorage` (`js/api.js`: configuración, cotizaciones y tablero
> salen de la base; en el navegador sólo queda el carrito en armado), y falta migrar lo que haya
> quedado cargado en cada navegador (`tools/respaldo-localstorage.js` + `npm run migrar`).
>
> **Agregado después:** la app puede **entrar sola, sin contraseña** (no hay pantalla de login: ver
> *La app entra sola*) y la base puede vivir **adentro del proyecto** (`api/datos`, sin Neon),
> levantando todo con `npm run local`.

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
│   ├── functions/api.js         # el API: entra sin contraseña + configuración + cotizaciones
│   ├── datos/                   # la base local (Postgres en una carpeta): no va al repo
│   ├── tools/                   # schema, usuario, acceso, base-local, migrar, revisar, servidor y humo
│   └── README.md                # puesta en marcha, deploy, pruebas y migración
├── icons/
│   ├── cubica.png              # logo maestro (original del diseñador)
│   └── cubica-logo.png         # logo optimizado: encabezado, favicon y PDF
├── tools/
│   ├── logo.html + logo.js     # regenera icons/cubica-logo.png desde el maestro
│   └── respaldo-localstorage.js # baja un JSON con lo guardado en este navegador
└── js/
    ├── utils.js                # helpers: uuid, moneda, escape
    ├── api.js                  # cliente del API: la única puerta del navegador hacia la base
    ├── store.js                # configuración del negocio: colores en stock y precios (por el API)
    ├── clicer.js               # producto Clicker de Nombre: letras (y símbolo), piezas por letra, precio y desglose
    ├── po.js                   # orden de producción (tandas por color y orden) y el ensamble
    ├── cart.js                 # carrito + datos de la cotización (borrador de este navegador)
    ├── proceso.js              # tablero Kanban: tarjetas congeladas (por el API)
    ├── pdf.js                  # plantilla A4 de la cotización y de la PO + visor + impresión/PDF
    ├── acceso.js               # aviso de arranque: entra sola, y si no puede, dice por qué
    ├── pin.js                  # la pantalla del PIN: se verifica al cuarto dígito (sin botón)
    ├── views/
    │   ├── productos.js        # menú de productos + formularios Llaveros y Clicker + carrito
    │   ├── carrito.js          # desglose: cantidades, datos, vista previa A4 y envío al tablero
    │   ├── proceso.js          # tablero Kanban: columnas, tarjetas, desglose de fabricar y ensamble
    │   └── configuracion.js    # colores + precios
    └── app.js                  # pestañas, enrutado por hash, chip del carrito y avisos
```

## Notas técnicas

- Se usan **scripts clásicos** (no ES modules) para que funcione abriendo el archivo con `file://`.
- El API vive aparte, en `api/`, con su propio `package.json` (Node) y un envuelto de seis líneas
  en `netlify/functions/api.mjs` para publicarlo junto al sitio: el frontend **no** ganó
  dependencias ni pasos de armado. Abrir `index.html` con doble clic sigue funcionando igual.
- Orden de carga en `index.html`: `utils` → `api` → `store` → `clicer` → `po` → `cart` → `proceso`
  → `pdf` → `acceso` → `pin` → `views` → `app`.
- El enrutador soporta sub-rutas (`#/productos/llaveros`, `#/productos/clicers`), así el botón **atrás**
  del navegador funciona; `ALIASES` traduce las rutas viejas (`cotizacion`, `trabajos`) a las nuevas.
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
- La **orden de producción** se arma en `js/po.js`: `PO.leer(items)` devuelve las tandas ya agrupadas
  (bases, teclas con su letra, llaveros, otros, materiales) y los totales, y `PO.resumen(items)`
  devuelve sólo los totales, que es lo que muestra el chip de la tarjeta. Se pinta con
  `PDF.documentoPO({ meta, items, etapa })`: la misma hoja A4 que la cotización, con las secciones de
  fabricación en lugar de los precios. `PDF.verPO()` y `PDF.imprimirPO()` son el equivalente de
  `PDF.ver()` y `PDF.imprimir()` para esa hoja, y el archivo se sugiere como
  `Produccion-0007-Cliente`. Si no hay nada que fabricar, `documentoPO` devuelve `''` y no se abre
  ni el visor ni el diálogo de impresión. La PO **no toca precios**: la plata sigue en la cotización.
- El **ensamble** (la receta de armado) lo arma `PO.ensamble(items)`: una entrada por clicker con su
  `cantidad` y una fila por letra (`caracter`, `simbolo`, la base con el color y el acabado por
  separado, la tecla y la letra). Es data cruda, sin sumar nada, porque la receta es de **una unidad**:
  cuántas piezas de cada color imprimir ya lo dice `PO.leer()`. El que parte «Café (Corrugado)» en los
  dos campos que pide la tabla es `PO.colorYAcabado()`. Un clicker viejo (de cuando el desglose venía
  con «Base» y «Nombre») no tiene receta, así que esa línea no aparece. La ventana vive en
  `js/views/proceso.js` (`abrirEnsamble`): cuelga del `<body>`, se borra al cerrarse y `@media print`
  la oculta, igual que el visor de `PDF.ver()`. El botón se ofrece desde «Trabajo» en adelante
  (`ENSAMBLE_DESDE` en `js/views/proceso.js`): se compara por **índice** de columna y no por nombre,
  así una columna nueva al final del tablero lo hereda sola.
- Las agrupaciones son por **clave ordenada**, no por conjuntos: tecla roja con letra blanca y tecla
  blanca con letra roja son dos tandas, igual que base blanca con letras negras y base negra con
  letras blancas. La clave de un color es `hex|nombre`, así que dos colores con el mismo hex pero
  distinto nombre no se mezclan.
