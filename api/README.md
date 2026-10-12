# API del cotizador Cubica3D

Una sola función HTTP sobre Postgres (Neon), que reemplaza el `localStorage` compartido del
negocio. Se publica como **función de Netlify**, junto al sitio: el frontend y el API comparten
dominio y la cadena de conexión vive en las variables de entorno del sitio, nunca en el código.

| Antes (en el navegador)                  | Ahora (en la base)                     |
|---|---|
| `cotizador.config.v1` — colores y precios | tabla `configuracion`                  |
| `cotizador.proceso.v1` — tarjetas del tablero | tablas `cotizaciones` + `cotizacion_items` |
| `Proceso.siguienteFolio()` — folio calculado en el cliente | `siguiente_folio()` en la base |
| *(no existía)*                            | `usuarios` + `sesiones` — quién hizo qué |

El **carrito en armado** (`cotizador.carrito.v1`) sigue siendo local a cada navegador a
propósito: es un borrador personal y si fuese compartido dos personas se pisarían.

La cadena de conexión a Postgres **nunca** llega al navegador: el frontend sólo habla con
esta API y la API es la única que conoce la base.

## Puesta en marcha (una vez)

```bash
cd api
npm install
# api/.env: pegá la cadena de Neon (la "pooled" en DATABASE_URL y la "directa" en
# DATABASE_URL_UNPOOLED). El archivo explica de dónde sacarlas.
npm run schema                    # aplica db/schema.sql (tablas + índice + siguiente_folio)
npm run usuario -- "correo@cubica3d.com" "Ana" "una-clave-larga"
npm run revisar                   # comprueba .env, conexión, tablas y usuarios (sin mostrar la contraseña)
```

También sirve que el `.env` lo complete el CLI de Neon: `npm install -g neon@latest`,
`neon link` y `neon env pull`.

`npm run revisar` es lo primero que conviene correr si algo no cierra: dice si falta la cadena,
si la base responde, en qué región está, si están las 7 tablas, si existe `siguiente_folio()` y
cuántos usuarios activos hay.

`api/.env` está en `.gitignore` (nunca se sube). En la raíz del repo hay un `.env` que **apunta a
este mismo archivo** (un enlace), porque `netlify dev` sólo lee el `.env` de la raíz: así la cadena
se pega una sola vez y la ven el emulador y los utilitarios. El `.env` es de tu máquina: la función
desplegada no lo lee, saca la cadena de las variables de entorno del sitio.

## Probarlo en tu máquina

El camino corto —y el que más se parece a producción— es **el mismo `.env`** con el emulador de
Netlify, que levanta el sitio y la función juntos:

```bash
cd ..                             # la raíz del repo
npx netlify dev                   # sitio: http://localhost:8888   ·   API: http://localhost:8888/api
```

El `.env` de la raíz es un enlace a `api/.env`: un solo archivo, la cadena se pega una vez y la ven
tanto el emulador como los utilitarios (si el enlace no estuviera: `ln -s api/.env .env`). En la
salida de `netlify dev` se ve que la tomó:

```
⬥ Injected .env file env vars: APP_ORIGEN, DATABASE_URL, DATABASE_URL_UNPOOLED
⬥ Loaded function api
```

En otra terminal:

```bash
curl -s localhost:8888/api                                          # {"ok":true,...}
curl -s localhost:8888/api/login -H 'Content-Type: application/json' \
     -d '{"email":"correo@cubica3d.com","password":"una-clave-larga"}'
# copiá el token de la respuesta y usalo así:
curl -s localhost:8888/api/bootstrap -H "Authorization: Bearer EL_TOKEN"
```

Si preferís no depender de Netlify, hay un servidor propio que lee el mismo `.env` y arranca en el
puerto 8787:

```bash
cd api
npm run server
```

Y con el CLI de Neon, `npm run dev` sirve la misma función con recarga automática.

### Sin Neon: la base adentro del proyecto

Si preferís que los datos **no salgan de tu máquina**, el proyecto trae una base propia: es el
mismo Postgres (PGlite, el motor compilado a WebAssembly) guardado en la carpeta `api/datos/`, con
el **mismo `db/schema.sql`** que usa Neon, así que no hay dos SQL que mantener.

```bash
cd api
npm run base-local          # la crea la primera vez y muestra cómo va
npm run server              # levanta el sitio Y el API en http://localhost:8787
```

`npm run server` sirve también el frontend (`index.html`, `css/`, `js/`, `icons/`) desde el mismo
puerto y el mismo origen, así que no hacen falta CORS, ni un segundo servidor de archivos, ni
`netlify dev`: se abre <http://localhost:8787> y ya está andando. Desde otra PC del taller se entra
por `http://<IP-de-esta-PC>:8787`; esos orígenes se habilitan solos, no hay que tocar `APP_ORIGEN`.

¿Cuál usa? La regla es una sola:

| En `api/.env` | Base que se usa |
|---|---|
| `BASE_LOCAL="true"` (o una ruta: `BASE_LOCAL="/Volumes/Disco/cotiza"`) | **la local** (`api/datos/`), aunque haya `DATABASE_URL` |
| sin `BASE_LOCAL`, con `DATABASE_URL` | **Neon** |
| sin ninguna de las dos | **la local** |

Los utilitarios (`usuario`, `acceso`, `schema`, `revisar`, `migrar`) respetan la misma regla: con
`BASE_LOCAL` o sin cadena trabajan sobre la base del proyecto, y con `DATABASE_URL` sobre Neon.

**Respaldar** (es tu única copia: vale la pena hacerlo seguido):

```bash
npm run base-local -- --respaldo      # deja api/respaldos/base-AAAAMMDD-HHMM.tar.gz
```

o se copia la carpeta `api/datos/` entera (con el servidor apagado). Para volver a esa copia: se
reemplaza la carpeta por la descomprimida.

**Dos límites, para no llevarse sorpresas:**

- **Un solo proceso por vez** sobre `api/datos/`. PGlite no tiene el candado de un Postgres de
  verdad, así que si el servidor está abierto y corrés un utilitario, éste avisa en vez de
  arriesgar los datos: cortá el servidor (`Ctrl+C`) y volvé a intentar.
- **No se puede desplegar.** En una función de Netlify el disco es efímero y por instancia: lo que
  se escriba ahí se pierde y cada copia de la función vería datos distintos. La base local es para
  la(s) máquina(s) del taller (una sola, que sirve a las demás); el sitio desplegado sigue
  necesitando una base de verdad como Neon. Si querés el sitio de Netlify con los datos en tu
  máquina, el camino es apuntar el frontend al servidor del taller con `window.CUBICA_API` (ver el
  README de la raíz) y exponer ese servidor con un túnel HTTPS.

Para no probar a mano, la prueba de humo recorre el camino completo (salud, login, bootstrap,
folio, guardar config, crear la cotización, moverla de columna, sacarla del tablero y cerrar
sesión): 14 comprobaciones, y no ensucia los datos porque la configuración se vuelve a guardar
igual que estaba y la cotización de prueba se borra sola. (Lo único que avanza es el contador de
folios, uno por corrida, como con cualquier cotización de verdad.)

```bash
npm run humo -- http://localhost:8888 correo@cubica3d.com "una-clave-larga"
```

Sirve igual contra el API desplegado: pasale su dirección en lugar de `localhost`.

## Publicarlo (Netlify)

El sitio de Netlify ya está vinculado a este repositorio, y la extensión de Neon le carga
`DATABASE_URL` sola. Así que publicar es lo de siempre:

```bash
git add -A && git commit -m "..." && git push
```

Netlify instala las dependencias (ese `npm install` es el paso que le da `pg` a la función),
empaqueta `netlify/functions/api.mjs` y publica el sitio. La API queda en
`https://cubica3d.netlify.app/api/…`, **en el mismo dominio que el frontend**, así que no hay
CORS de por medio en producción.

Sin pasar por Git también se puede publicar desde tu máquina:

```bash
npx netlify deploy --prod           # desde la raíz del repo
npx netlify deploy --alias prueba   # borrador, sin tocar producción
```

Variables del sitio (Site configuration -> Environment variables):

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | la cadena de Neon: **la misma que tenés en el `.env`**. Ya está puesta (la carga la extensión de Neon); si algún día no la usás, se pega a mano acá y no hace falta nada más |
| `APP_ORIGEN` | dominios autorizados a llamar la API, separados por coma. Ej.: `https://cubica3d.netlify.app,http://localhost:8000`. Vacía = refleja cualquier origen: cómodo para probar, **no** para producción |

`APP_ORIGEN` en Netlify y el de `api/.env` conviene mantenerlos iguales (el del `.env` es el que
aplica cuando corrés el API en tu máquina o lo pruebas con `npm run humo`).

Errores de la función:

```bash
npx netlify logs --function api
```

### También en Neon (opcional)

`functions/api.js` es autocontenido y sólo importa `pg`, así que lo puede empaquetar cualquier
plataforma. Para publicarlo como Neon Function:

```bash
cd api
neon link                           # requiere el login de Neon (navegador)
npm run deploy                      # https://<rama>-api.compute.<region>.neon.tech
neon functions get api -o yaml      # invocation_url: esa es la dirección
```

> Neon Functions exige que el proyecto esté en `aws-us-east-1`, `aws-us-east-2`,
> `aws-eu-central-1` o `aws-ap-southeast-1`.

`npm run deploy` agrega `--no-env-pull` a propósito: por defecto `neon deploy` reescribe el
`.env` local con las variables de la rama y se llevaría puesto el `APP_ORIGEN` y los comentarios
del archivo. Si cambiás de rama: `neon link && neon env pull`.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api` | Saludo; sirve para verificar que la función está viva (en local y en Neon también contesta en `/`) |
| `POST` | `/api/login` | `{ email, password }` → `{ token, usuario }` |
| `GET` | `/api/pin` | `{ requerido, digitos, aviso }`: si este cotizador pide PIN (lo pregunta la app al abrirse) |
| `POST` | `/api/pin` | `{ pin }` → `{ ok: true, token, usuario }`; con el PIN mal, `401 { error }`. Con PIN puesto, es la **única** entrada (ver *El PIN*) |
| `POST` | `/api/acceso` | Sin cuerpo: abre la sesión de la **cuenta del taller** (`ACCESO_EMAIL` o la primera activa) → `{ automatico: true, token, usuario }`; con `ACCESO_LIBRE="false"`, `{ automatico: false, aviso }` |
| `POST` | `/api/logout` | Invalida el token |
| `GET` | `/api/bootstrap` | Config + tablero + folio siguiente + quién sos (una sola llamada al abrir la app) |
| `GET` | `/api/tablero` | Sólo las tarjetas (lo que consulta el refresco periódico) |
| `GET` | `/api/folio` | El folio que va a entregar el servidor (`{ siguiente }`) |
| `PUT` | `/api/config` | `{ colores, precios }` → guarda la configuración del negocio |
| `POST` | `/api/cotizaciones` | `{ clientId, meta, items }` → guarda la copia congelada |
| `PATCH` | `/api/cotizaciones/:id` | `{ columna }` → mueve la tarjeta (entra arriba del destino) |
| `DELETE` | `/api/cotizaciones/:id` | Borrado suave: sale del tablero, queda la historia |

Todo menos `/api`, `/api/login`, `/api/pin` y `/api/acceso` exige `Authorization: Bearer <token>`. Las
cuatro son públicas a propósito: son las puertas de entrada (`/api/pin` y `/api/acceso` son las que usa
la app, que no tiene pantalla de login) y ninguna entrega sesión si el dueño del servidor puso el PIN
o `ACCESO_LIBRE="false"` en su `.env`.

## Cómo se guardan las cosas

- **El folio lo asigna la base** (`siguiente_folio()`), no el navegador: dos personas
  cotizando a la vez nunca obtienen el mismo número. Si el formulario traía un folio que ya
  no está libre, la respuesta lo avisa con `folioReasignado: true` en vez de mentir.
- **El total y las unidades los calcula el servidor** a partir de los productos: si alguien
  manipula el navegador, no puede inflar una cotización ya guardada.
- **Idempotencia:** el carrito manda un `clientId`; si el envío se repite (doble clic, red
  lenta), la API devuelve la misma tarjeta con `repetida: true` en lugar de duplicarla.
- **Borrado suave:** `DELETE` marca `borrada_en`; la tarjeta desaparece del tablero pero sus
  líneas quedan para poder reportar ("cuántos llaveros se vendieron en marzo").
- **Bitácora:** cada creación, movimiento y borrado deja una fila en `movimientos` con
  usuario y hora.
- **Sesiones:** se guarda el SHA-256 del token, nunca el token. Duran 30 días.
- **Contraseñas:** `scrypt` (N=16384) con sal por usuario, comparadas en tiempo constante.

## La cuenta del taller (la app entra sola)

La app **no tiene pantalla de login**: al abrirse llama a `POST /api/acceso` y el servidor le abre
una sesión con la cuenta del taller, sin correo ni contraseña. Se configuran en `api/.env` o en las
variables del sitio, si está en Netlify:

```bash
ACCESO_LIBRE="true"            # entra sin contraseña (es lo que quiere el taller)
ACCESO_NOMBRE="Victor"
ACCESO_EMAIL="correo@cubica3d.com"
ACCESO_CLAVE="una-clave-larga"  # sólo para crear la cuenta: nadie la escribe
PIN="3008"                      # opcional: 4 dígitos y la página pide el PIN al abrirse (ver abajo)

cd api && npm run acceso        # crea/actualiza esa cuenta en la base (no se toca a mano)
```

- Con qué cuenta entra: con la de `ACCESO_EMAIL` si existe y está activa; si no (o si no está
  configurada), con la **primera cuenta activa** de la base.
- La cuenta se deja lista sola: **`npm run server` la crea o la actualiza al arrancar**
  (`tools/asegurar-acceso.js`), y si la base está recién creada y el `.env` no tiene cuenta, inventa
  `taller@cubica3d.local` con una clave al azar que nadie usa: así el cotizador abre igual en una
  máquina nueva, sin configurar nada.
- La clave **nunca viaja al navegador**: el navegador llama `POST /api/acceso` sin datos y recibe un
  token igual que cualquier login (dura 30 días). En Postgres sólo queda su hash scrypt.
- Si no puede entrar (base sin ninguna cuenta activa, servidor caído), la app muestra el motivo y un
  botón **Reintentar**: nunca pide credenciales.
- Apagado (`ACCESO_LIBRE="false"`), `/api/acceso` contesta `{ automatico: false, aviso }` y la única
  puerta es `POST /api/login` con correo y contraseña (para scripts y herramientas; la app del
  navegador no tiene formulario). El viejo `ACCESO_AUTOMATICO` se sigue leyendo como alias.
- **No hay botón «Salir»**: como el servidor entra solo, cerrar la sesión no tenía sentido. Para
  cortar el acceso de alguien, desactivá o borrá su cuenta (ver *Tareas de todos los días*).

### El PIN (4 dígitos)

Con `PIN` puesta y con 4 dígitos, el cotizador queda **cerrado con llave**:

- La app pregunta `GET /api/pin` al abrirse y, si la respuesta dice que sí, muestra el **pinpad**
  (`js/pin.js`). Al **cuarto dígito** se verifica solo —no hay botón de entrar— y, si está bien, el
  servidor abre la misma sesión de siempre (`POST /api/pin` → token de 30 días, igual que `/api/login`).
- Con PIN puesto, **`/api/acceso` deja de entregar sesión**: contesta `{ automatico: false, pin: true }`.
  Si no fuera así, quien conociera la ruta entraría sin escribir nada y el PIN sería un adorno.
- Los intentos fallidos se cuentan **por instancia**: 5 cada 15 minutos (`429`). Alcanza para que probar
  los 10.000 números no sea gratis, pero **no es una contraseña**: es una llave de 4 dígitos.
- Si la variable tiene otra cosa que no sean 4 dígitos (`PIN="casa"`), el cotizador **no se abre** y lo
  dice en pantalla: mejor eso que quedar abierto creyendo que está protegido. Una variable vacía
  (`PIN=`) es como no tenerla.
- El PIN nunca queda escrito en el navegador: se manda una vez y lo que se guarda es el token.
- Para que la app entre sola otra vez, borrá `PIN` (del `.env` y de las variables del sitio).

## Pruebas

```bash
npm test          # 26 pruebas: rutas, CORS, entrada sin contraseña, saneo, folios, idempotencia, permisos
npm run test:db   # 10 pruebas contra un Postgres REAL en memoria (PGlite)
npm run test:db2  #  4 pruebas de la migración, también contra Postgres real
```

`npm test` usa una base simulada (no necesita nada instalado). Las otras dos usan
**PGlite**, que es Postgres compilado a WebAssembly: aplican `db/schema.sql` de verdad y
corren la misma API que se despliega, así que verifican el `INSERT` con CTE, el contador de
folios, los índices únicos y que las fechas y los importes vuelvan con los tipos esperados.
No tocan Neon ni ninguna base de verdad. (`@electric-sql/pglite` viene como dependencia de
desarrollo; si no vas a correr estas dos baterías, se puede sacar del `package.json`.)

## Migrar los datos que hoy están en el navegador

```bash
# 1) Con los datos a la vista, en el navegador: F12 -> Consola y pegá
#    tools/respaldo-localstorage.js   (descarga respaldo-cubica3d.json)
# 2) Acá:
npm run migrar -- ../respaldo-cubica3d.json
```

Se puede correr las veces que haga falta: cada tarjeta queda marcada como `migrado:<id>` y
las ya migradas se saltean. Avisa si tuvo que reasignar algún folio repetido (el sistema
viejo permitía escribir cualquier folio a mano) y deja el contador de folios por encima del
número más alto del respaldo.

## Tareas de todos los días

```bash
npm run usuario -- "otro@cubica3d.com" "Bea" "otra-clave-larga"   # crear usuario
npm run usuario -- "bea@cubica3d.com" "Bea" "clave-nueva"         # cambiar contraseña
npm run acceso                                                    # la cuenta del taller, al día
npm run schema                                                    # reaplicar el esquema (es idempotente)
npm run revisar                                                   # estado de todo: .env, base, tablas, usuarios
npm run base-local                                                # estado de la base local (api/datos)
npm run base-local -- --respaldo                                  # copia de la base local en api/respaldos/
npm run humo -- <dirección-del-API> correo "clave"                # el API responde de punta a punta
npx netlify logs --function api                                   # ver errores
```

- **Sacar a alguien:** `update usuarios set activo = false where email = '...';` Sus sesiones
  dejan de valer en la siguiente consulta.
- **Respaldos:** Neon guarda la historia de la rama; desde el panel se puede restaurar a un
  punto en el tiempo. Además, en cualquier momento: `pg_dump "$DATABASE_URL_UNPOOLED" > copia.sql`.
- **Respaldos de la base local:** `npm run base-local -- --respaldo` (o copiar `api/datos/` con el
  servidor apagado). No hay historia: si el archivo se rompe, se vuelve a la última copia.

## Archivos

```
api/
├── neon.ts                 # declara la función para el CLI de Neon (`neon dev` / `neon deploy`)
├── package.json            # dependencias y atajos (dev, deploy, test, schema, usuario, acceso, migrar, revisar, server, base-local, humo)
├── .env.example            # qué variables hacen falta (el .env real está en .gitignore)
├── functions/
│   └── api.js              # TODO el API en un archivo: se despliega tal cual, sin armado previo
├── datos/                  # la base local (Postgres en una carpeta): NO va al repo
├── respaldos/              # volcados de la base local (`npm run base-local -- --respaldo`)
├── tools/
│   ├── conectar.js         # la base que corresponda: Neon si hay DATABASE_URL, si no la local
│   ├── base-local.js       # la base del proyecto (PGlite en api/datos), con candado y respaldo
│   ├── aplicar-schema.js   # npm run schema
│   ├── crear-usuario.js    # npm run usuario (scrypt, mismo formato que api.js)
│   ├── asegurar-acceso.js  # npm run acceso: la cuenta del taller (con la que la app entra sola)
│   ├── revisar.js          # npm run revisar: diagnóstico de .env, base, tablas y usuarios
│   ├── servidor-local.js   # npm run server: el sitio y el API en tu máquina, en un solo puerto
│   ├── humo.js             # npm run humo: recorrido completo contra un API que ya corre
│   └── migrar.js           # npm run migrar
└── __*.test.js             # baterías (están en .gitignore: son herramientas, no app)

../.env                     # enlace a api/.env: es el que lee `netlify dev` (no se sube)
../netlify.toml             # config del sitio: publica la raíz y empaqueta la función
../netlify/functions/
│   └── api.mjs             # envuelto de Netlify: le pasa la petición a functions/api.js
../package.json             # `pg` para la función (Netlify instala de acá)
../db/schema.sql            # el esquema completo, comentado, en un solo archivo
../tools/respaldo-localstorage.js   # respaldo del navegador (se pega en la consola)
```

`functions/api.js` es autocontenido a propósito (no importa archivos relativos): así lo puede
empaquetar cualquier plataforma, y el envuelto de cada una vive afuera (`netlify/functions/` para
Netlify, `neon.ts` para Neon).
