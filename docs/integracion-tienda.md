# Manual de integración: cubica3d.shop → cubica3d.netlify.app

Para quien construya la tienda (**cubica3d.shop**) y necesite que los pedidos lleguen al
sistema de control (**cubica3d.netlify.app**, "el cotizador").

> Estado: este documento describe cómo conectarse **con lo que el cotizador ya tiene hoy** (Fase 0)
> y propone el contrato que conviene agregar después (Fase 1). Nada de esto exige cambios en el
> cotizador para empezar.

---

## 1. Cómo se conectan (la idea)

```
Cliente ──► cubica3d.shop (tienda)
                │  arma el diseño, calcula el precio, cobra (si aplica)
                │
                ▼  servidor → servidor (HTTPS + JSON)
        cubica3d.netlify.app/api   (cotizador)
                │
                ▼
        tarjeta nueva en la columna «Cotización» del tablero (Proceso)
```

- Es una **API REST normal**. No hace falta un MCP: un MCP sirve para que un modelo de IA use
  herramientas; aquí hablan dos programas. (Se podría envolver esta misma API en un MCP más
  adelante si quieres que Claude opere el tablero, pero la tienda no lo necesita.)
- La tienda **siempre llama desde su servidor** (una Netlify Function de la tienda, no desde el
  navegador del cliente). Las credenciales nunca viajan al navegador.
- El cotizador responde con la tarjeta creada (folio, id). La tienda guarda ese `id` y el `folio`
  junto a su propio pedido.

---

## 2. Fase 0 — conectarse hoy, sin tocar el cotizador

### 2.1 Credenciales

El API ya tiene usuarios. Crea uno **solo para la tienda** (en tu máquina, una vez):

```bash
cd api
npm run usuario -- "tienda@cubica3d.shop" "Tienda web" "<clave-larga-y-unica>"
```

Guarda correo y clave **solo** en variables de entorno del servidor de la tienda
(`COTIZADOR_EMAIL`, `COTIZADOR_CLAVE`, `COTIZADOR_URL=https://cubica3d.netlify.app`).
Nunca en el código ni en el navegador.

### 2.2 Abrir sesión

```http
POST https://cubica3d.netlify.app/api/login
Content-Type: application/json

{ "email": "<COTIZADOR_EMAIL>", "password": "<COTIZADOR_CLAVE>" }
```

Respuesta `200`:

```json
{ "token": "…", "usuario": { "id": "…", "nombre": "Tienda web", "email": "…" }, "diasSesion": 30 }
```

- El token dura **30 días**. Guárdalo en memoria/caché del servidor y renuévalo cuando una llamada
  devuelva `401` (vuelve a hacer login y reintenta una vez).
- Límite: 10 intentos de login por correo cada 15 minutos (`429` si se pasa). No hagas login en cada
  pedido: reutiliza el token.
- El PIN del taller **no** aplica aquí (`/api/login` es otra puerta).

Todas las demás llamadas llevan `Authorization: Bearer <token>`.

### 2.3 Leer colores y precios (los de verdad)

```http
GET /api/bootstrap
Authorization: Bearer <token>
```

Del resultado, la tienda solo debe usar `config`:

```json
{
  "config": {
    "colores": [ { "id": "…", "nombre": "Negro", "hex": "#111111" } ],
    "precios": {
      "nombre": 0, "nombreApellido": 0,
      "clicer": { "porLetraCorto": 15, "porLetraLargo": 30, "letrasCorte": 5 },
      "charm":  { "precio30": 200, "precio55": 350 }
    }
  }
}
```

> ⚠️ `/api/bootstrap` también trae **todo el tablero** (clientes, totales, notas). Es solo para uso
> del servidor de la tienda; **jamás** reenviarlo al navegador. En la Fase 1 hay un endpoint de
> catálogo que trae únicamente colores y precios.

Reglas:
- Los **colores disponibles son los de `config.colores`** (stock del taller). La tienda debe
  ofrecer solo esos, y mandar **exactamente** su `nombre` y su `hex`. Si no coinciden, el
  taller no puede editar la tarjeta después y la impresión 3D agrupa mal los colores.
- Refresca el catálogo cada pocos minutos (cache corta). Los precios pueden cambiar.

### 2.4 Crear la cotización (el pedido)

```http
POST /api/cotizaciones
Authorization: Bearer <token>
Content-Type: application/json

{
  "clientId": "tienda-<id-del-pedido-en-la-tienda>",
  "meta": {
    "cliente": "Ana López",
    "notas": "🛒 Pedido web #1042\nTel: 55 1234 5678\nEmail: ana@correo.com\nEnvío: Calle … (o: recoge en taller)",
    "fecha": "2026-11-13"
  },
  "items": [ … ver §3 … ]
}
```

- `clientId` es **la llave de idempotencia**: si la tienda reintenta (corte de red, doble clic) con
  el mismo `clientId`, el cotizador devuelve la misma tarjeta con `"repetida": true` y **no crea
  duplicados**. Usa un valor estable por pedido (`tienda-<id>`), máx. 80 caracteres.
- `meta.cliente` (máx. 120) es el nombre que se ve en la tarjeta. `meta.notas` (máx. 2000) es el
  único lugar para contacto/dirección/instrucciones **hoy** (no hay campos de teléfono/correo).
  Los enlaces `http(s)://` en las notas son clicables en el tablero.
- `meta.fecha` opcional (`AAAA-MM-DD`); sin ella toma hoy. `meta.folio` se ignora: el servidor
  asigna el folio.
- `meta.descuento` (pesos) y `meta.descuentoNota` son opcionales. El descuento nunca supera el subtotal.
- El servidor calcula `total = Σ(precio × cantidad) − descuento` y `unidades`.

Respuesta `200`:

```json
{
  "cotizacion": { "id": "uuid", "folio": 57, "cliente": "Ana López", "columna": "cotizacion",
                  "total": 90, "items": [ … ], "pagado": false },
  "folioReasignado": false,
  "folioSiguiente": 58
}
```

Guarda `cotizacion.id` y `cotizacion.folio`. La tarjeta entra **arriba de la columna «Cotización»**.

Errores: `400` (cuerpo inválido / sin productos), `401` (sesión vencida → login de nuevo),
`403` (origen no autorizado, ver §5), `500`.

### 2.4.1 Adjuntar archivos (logos, imágenes del cliente)

Después de crear la tarjeta:

```http
POST /api/cotizaciones/<id>/archivos
Authorization: Bearer <token>
Content-Type: application/json

{ "nombre": "logo.png", "tipo": "image/png", "datos": "<base64 sin prefijo data:>" }
```

Tipos: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`.
Máx. **3 MB** por archivo (ya decodificado) y **5 archivos por tarjeta**. Respuesta: la tarjeta actualizada.
Para STL/3MF aún no hay soporte: mándalos como **enlace** en `meta.notas`.

---

## 3. Formato de las líneas (`items`)

Cada línea: `{ tipo, titulo, precio, cantidad, detalles[] }`.

- `tipo`: el nombre del producto (texto exacto, ver abajo). **Es lo que el taller usa para entender
  qué fabricar** — respétalo letra por letra.
- `titulo`: el nombre/texto personalizado (máx. 120). Se muestra en la tarjeta: `1× Clicker “Alec”`.
- `precio`: precio de **una** unidad, en pesos (el servidor lo guarda tal cual: ver §4 sobre confianza).
- `cantidad`: entero ≥ 1.
- `detalles`: lista de `{ label, nombre, hex }` (máx. 60 / 120 / 20 caracteres). Es el desglose de
  piezas y colores; el orden y los `label` importan porque el taller y la impresión 3D los leen.

### 3.1 Clicker de Nombre — `tipo: "Clicker de Nombre"`

- `titulo`: el nombre. **Una sola palabra**, solo letras, números y emojis (sin espacios ni signos).
  Cada letra/número/emoji es una tecla.
- Por **cada letra, en orden**, exactamente **tres** detalles consecutivos: Base, Tecla, Letra.
- Etiquetas: `"<CARÁCTER> · Base"`, `"<CARÁCTER> · Tecla"`, `"<CARÁCTER> · Letra"` (el separador es
  ` · ` con el punto medio `·`). El carácter va en MAYÚSCULA.
- Base: `nombre` = `"<Color> (<Acabado>)"` con acabado **`Corrugado`** o **`Liso`** exactamente.
  Ej.: `"Negro (Corrugado)"`. Tecla y Letra: solo el nombre del color.
- La cantidad de detalles **debe ser múltiplo de 3** y respetar ese orden; si no, el taller no puede
  generar la receta de ensamble ni la impresión 3D.
- Precio de una unidad: `letras = número de teclas`; si `letras > letrasCorte` →
  `porLetraLargo × letras`, si no → `porLetraCorto × letras` (todas las letras al mismo precio, el del tramo).

```json
{
  "tipo": "Clicker de Nombre",
  "titulo": "ALEC",
  "precio": 60,
  "cantidad": 1,
  "detalles": [
    { "label": "A · Base",  "nombre": "Negro (Corrugado)", "hex": "#111111" },
    { "label": "A · Tecla", "nombre": "Rojo",              "hex": "#d62828" },
    { "label": "A · Letra", "nombre": "Blanco",            "hex": "#ffffff" },
    { "label": "L · Base",  "nombre": "Negro (Corrugado)", "hex": "#111111" },
    "… (3 por cada letra restante: L, E, C)"
  ]
}
```

> 🖨️ La impresión 3D del taller solo tiene STL de **A–Z y 0–9**. Una letra con acento, Ñ o un emoji
> se vende pero **no se imprime automáticamente** (el taller la resuelve a mano). Si quieres evitar
> fricción, restringe la tienda a A–Z y 0–9 (o avisa al cliente).

### 3.2 Llavero de Nombre — `tipo: "Llavero de Nombre"`

- `titulo`: `"Nombre"` o `"Nombre Apellido"`.
- Precio: `config.precios.nombre` (solo nombre) o `config.precios.nombreApellido` (con apellido).
- Detalles (en este orden): `Base` y `Nombre`.

```json
{ "tipo": "Llavero de Nombre", "titulo": "Ana López", "precio": 90, "cantidad": 1,
  "detalles": [
    { "label": "Base",   "nombre": "Negro", "hex": "#111111" },
    { "label": "Nombre", "nombre": "Blanco", "hex": "#ffffff" } ] }
```

### 3.3 Charm con cinta — `tipo: "Charm con cinta"` (antes «Charm para Silla»)

- `titulo`: el texto (máx. 40 piezas sin contar espacios; admite números, signos y emojis).
- Dos medidas de cinta: **30 cm** (`config.precios.charm.precio30`, hoy $200) y **55 cm**
  (`config.precios.charm.precio55`, hoy $350). El precio solo depende de la medida.
- El **primer detalle** es la medida: `{ "label": "Medida", "nombre": "30 cm", "hex": "" }` (o `"55 cm"`).
- Después, por cada pieza (letra/número/símbolo, sin espacios) dos detalles: `"<CARÁCTER> · Base"` y
  `"<CARÁCTER> · Tapa"`. Al final, los charms sueltos como `{ "label": "Charm", "nombre": "pelota de volly", "hex": "" }`.

### 3.4 Llavero personalizado / cualquier otro producto — `tipo: "Cotización manual"`

Aún no hay un tipo propio para el llavero personalizado. Mientras tanto usa la línea manual:

```json
{ "tipo": "Cotización manual", "titulo": "Llavero personalizado – logo Café Luna", "precio": 120, "cantidad": 10,
  "detalles": [
    { "label": "Color usado ×2", "nombre": "Negro", "hex": "#111111" },
    { "label": "Color usado",    "nombre": "Blanco", "hex": "#ffffff" } ] }
```

`"Color usado"` = una pieza de ese color; `"Color usado ×N"` = N piezas (así cuentan en las
estadísticas de color). Pon el detalle del diseño en `meta.notas` y adjunta el logo (§2.4.1).

---

## 4. Lo que la tienda debe respetar (importante)

1. **El cotizador confía en el precio que recibe.** Hoy el API no recalcula precios (solo exige
   número ≥ 0). Quien manda el precio es responsable de que sea correcto: **la tienda debe calcularlo
   en su servidor** con los precios de `config.precios` — nunca confiar en el precio que mande el
   navegador del cliente. (La Fase 1 lo valida también del lado del cotizador.)
2. **Colores solo del stock** (§2.3): `nombre` + `hex` idénticos a `config.colores`.
3. **Idempotencia**: siempre `clientId` estable por pedido.
4. **Datos personales**: nombre, teléfono, dirección y correo van en `meta.notas`. Son datos de
   clientes: no los registres en logs de la tienda más de lo necesario.
5. **Límites**: `titulo` 120, `tipo` 40, `cliente` 120, `notas` 2000, detalle `label` 60 / `nombre` 120 /
   `hex` 20; cuerpo de la petición ≲ 6 MB (límite de Netlify). Una línea sin `titulo` se descarta en silencio.
6. **Tras el envío, el taller ve el pedido en «Cotización»** y de ahí lo mueve (Confirmado → Trabajo →
   Fabricado → Realizado → Entregado). La tienda **no mueve** columnas.

---

## 5. Origen (CORS) y red

- Desde un **servidor** (Netlify Function de la tienda) no hay cabecera `Origin`; el API contesta
  sin problema.
- Si por algo se llamara desde un navegador, `https://cubica3d.shop` tendría que estar en la variable
  `APP_ORIGEN` del sitio del cotizador (lista separada por comas). **No lo hagas desde el navegador**
  con estas credenciales: darían acceso total al taller.
- Alcance del token de la Fase 0: **acceso completo** (leer todo el tablero, mover, borrar, cambiar
  precios). Por eso es temporal y por eso la tienda lo usa solo desde su servidor. Es el motivo de la Fase 1.

---

## 6. Avisar el pago (opcional)

Si la tienda cobra en línea (Stripe, Mercado Pago…), al confirmarse el pago:

```http
PATCH /api/cotizaciones/<id>
Authorization: Bearer <token>
Content-Type: application/json

{ "pagado": true, "fechaPago": "2026-11-13" }
```

`fechaPago` (`AAAA-MM-DD`) es la fecha que cuentan las estadísticas de ventas. También se puede
dejar una nota de referencia con `{ "notas": "…" }` (reemplaza **todo** el campo: léelo primero si
quieres conservarlo).

---

## 7. Fase 1 — decisión: la tienda SOLO envía cotizaciones

Acuerdo: la única interacción de la tienda con el control es **mandar una cotización**, que cae en
una columna propia llamada **«Pedidos online»** (aún no existe: se crea en el cotizador cuando se
implemente esta fase). La tienda no lee el tablero, no mueve tarjetas y no ve precios ni colores
del taller a través de él; para eso el cotizador publica una ruta de catálogo mínima.

Una sola ruta de escritura, con una **API key de solo-tienda** (`TIENDA_API_KEY`, en el cotizador y en
el servidor de la tienda; cabecera `Authorization: Bearer <key>`). Esa llave **no** abre ninguna otra ruta.

```http
POST /api/tienda/pedidos
Authorization: Bearer <TIENDA_API_KEY>
Content-Type: application/json
```

```json
{
  "pedidoId": "1042",
  "cliente": { "nombre": "Ana López", "correo": "ana@correo.com", "telefono": "55 1234 5678",
               "direccion": "Calle … (o: recoge en taller)" },
  "notas": "Regalo, entregar antes del 20",
  "items": [ …las mismas líneas de la §3… ]
}
```

El cotizador, al recibirlo:
- crea la tarjeta en **«Pedidos online»** (arriba de la columna), con folio propio y
  `clientId = "tienda-<pedidoId>"` (idempotente: reenviar el mismo `pedidoId` no duplica);
- pone nombre, correo, teléfono y dirección del cliente en las notas de la tarjeta (hasta que existan
  campos propios);
- **valida colores** contra el stock y **recalcula el precio** de cada línea; si algo no cuadra
  contesta `422` con el motivo y no crea nada (la tienda debe mostrar el error o corregir);
- responde `{ "folio": 57, "id": "uuid", "total": 90 }` (la tienda lo guarda).

Rutas auxiliares recomendadas (solo lectura, con la misma llave):
- `GET /api/tienda/catalogo` → solo `colores` + `precios`, para que la tienda arme su formulario y
  calcule el precio que muestra al cliente (el cotizador igual lo recalcula).

Mientras esta ruta no exista, la tienda puede enviar por la Fase 0 (`POST /api/cotizaciones`,
mismas líneas, `meta.cliente` + `meta.notas`); la tarjeta caerá en «Cotización» en vez de «Pedidos
online». El formato de las **líneas (`items`) es el mismo** en ambas fases: la tienda no tiene que
rehacer nada al migrar.

---

## 8. Checklist para quien programa la tienda

- [ ] Variables de entorno del servidor: `COTIZADOR_URL`, `COTIZADOR_EMAIL`, `COTIZADOR_CLAVE`.
- [ ] Función `loginCotizador()` con token en caché y reintento en `401`.
- [ ] Función `obtenerCatalogo()` con caché corta (colores + precios).
- [ ] El precio se calcula **en el servidor de la tienda** con los precios del catálogo.
- [ ] Los colores se eligen solo de `config.colores` (nombre y hex tal cual).
- [ ] Clicker: nombre de una palabra, 3 detalles por letra en orden, acabado `Corrugado`/`Liso`.
- [ ] `clientId = "tienda-<idPedido>"` en cada `POST /api/cotizaciones`.
- [ ] Contacto y dirección del cliente en `meta.notas`.
- [ ] Guardar `cotizacion.id` y `cotizacion.folio` en el pedido de la tienda.
- [ ] Logos del cliente adjuntados con `/archivos` (≤ 3 MB, ≤ 5 por pedido).
- [ ] Probar primero en local: `http://localhost:8787` (el cotizador local) con `POST /api/login` y un
      usuario de prueba; comprobar que la tarjeta aparece en el tablero.

### Prueba rápida con curl (reemplaza los valores)

```bash
URL=https://cubica3d.netlify.app
TOKEN=$(curl -s -X POST $URL/api/login -H 'Content-Type: application/json' \
  -d '{"email":"tienda@cubica3d.shop","password":"<CLAVE>"}' | jq -r .token)

curl -s -X POST $URL/api/cotizaciones -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "clientId":"tienda-prueba-1",
    "meta":{"cliente":"Prueba tienda","notas":"🛒 Pedido web de prueba"},
    "items":[{"tipo":"Llavero de Nombre","titulo":"Ana","precio":90,"cantidad":1,
      "detalles":[{"label":"Base","nombre":"Negro","hex":"#111111"},
                  {"label":"Nombre","nombre":"Blanco","hex":"#ffffff"}]}]}'
```
