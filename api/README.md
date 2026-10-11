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

`api/.env` está en `.gitignore` (nunca se sube) y es **sólo para los utilitarios de tu máquina**:
la función desplegada no lo lee, saca la cadena de las variables de entorno del sitio.

## Probarlo en tu máquina

```bash
npm run server                    # http://localhost:8787 (lee las variables de api/.env)
```

El emulador de Netlify levanta exactamente lo que se publica (sitio + función):

```bash
npx netlify dev                   # desde la raíz del repo: sitio en :8888 y API en /api
```

Y con el CLI de Neon, `npm run dev` sirve la misma función con recarga automática.

En otra terminal:

```bash
curl -s localhost:8787/api                                          # {"ok":true,...}
curl -s localhost:8787/api/login -H 'Content-Type: application/json' \
     -d '{"email":"correo@cubica3d.com","password":"una-clave-larga"}'
# copiá el token de la respuesta y usalo así:
curl -s localhost:8787/api/bootstrap -H "Authorization: Bearer EL_TOKEN"
```

Y para no probar a mano, la prueba de humo recorre el camino completo (salud, login, bootstrap,
folio, guardar config, crear la cotización, moverla de columna, sacarla del tablero y cerrar
sesión): 14 comprobaciones, y no ensucia los datos porque la configuración se vuelve a guardar
igual que estaba y la cotización de prueba se borra sola. (Lo único que avanza es el contador de
folios, uno por corrida, como con cualquier cotización de verdad.)

```bash
npm run humo -- http://localhost:8787 correo@cubica3d.com "una-clave-larga"
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
| `DATABASE_URL` | la cadena de Neon; la pone la extensión de Neon, no hay que pegar nada a mano |
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
| `POST` | `/api/logout` | Invalida el token |
| `GET` | `/api/bootstrap` | Config + tablero + folio siguiente + quién sos (una sola llamada al abrir la app) |
| `GET` | `/api/tablero` | Sólo las tarjetas (lo que consulta el refresco periódico) |
| `GET` | `/api/folio` | El folio que va a entregar el servidor (`{ siguiente }`) |
| `PUT` | `/api/config` | `{ colores, precios }` → guarda la configuración del negocio |
| `POST` | `/api/cotizaciones` | `{ clientId, meta, items }` → guarda la copia congelada |
| `PATCH` | `/api/cotizaciones/:id` | `{ columna }` → mueve la tarjeta (entra arriba del destino) |
| `DELETE` | `/api/cotizaciones/:id` | Borrado suave: sale del tablero, queda la historia |

Todo menos `/api` y `/api/login` exige `Authorization: Bearer <token>`.

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

## Pruebas

```bash
npm test          # 22 pruebas: rutas, CORS, sesión, saneo, folios, idempotencia, permisos
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
npm run schema                                                    # reaplicar el esquema (es idempotente)
npm run revisar                                                   # estado de todo: .env, base, tablas, usuarios
npm run humo -- <dirección-del-API> correo "clave"                # el API responde de punta a punta
npx netlify logs --function api                                   # ver errores
```

- **Sacar a alguien:** `update usuarios set activo = false where email = '...';` Sus sesiones
  dejan de valer en la siguiente consulta.
- **Respaldos:** Neon guarda la historia de la rama; desde el panel se puede restaurar a un
  punto en el tiempo. Además, en cualquier momento: `pg_dump "$DATABASE_URL_UNPOOLED" > copia.sql`.

## Archivos

```
api/
├── neon.ts                 # declara la función para el CLI de Neon (`neon dev` / `neon deploy`)
├── package.json            # dependencias y atajos (dev, deploy, test, schema, usuario, migrar, revisar, server, humo)
├── .env.example            # qué variables hacen falta (el .env real está en .gitignore)
├── functions/
│   └── api.js              # TODO el API en un archivo: se despliega tal cual, sin armado previo
├── tools/
│   ├── conectar.js         # conexión a Postgres para los utilitarios (lee api/.env)
│   ├── aplicar-schema.js   # npm run schema
│   ├── crear-usuario.js    # npm run usuario (scrypt, mismo formato que api.js)
│   ├── revisar.js          # npm run revisar: diagnóstico de .env, base, tablas y usuarios
│   ├── servidor-local.js   # npm run server: el API en tu máquina, con las variables de api/.env
│   ├── humo.js             # npm run humo: recorrido completo contra un API que ya corre
│   └── migrar.js           # npm run migrar
└── __*.test.js             # baterías (están en .gitignore: son herramientas, no app)

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
