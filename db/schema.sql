-- Base de datos compartida del cotizador Cubica3D (Neon Postgres).
--
-- Se aplica sobre una base vacía:
--   psql "$DATABASE_URL_UNPOOLED" -f db/schema.sql
-- o, sin psql instalado:
--   cd api && npm run schema
--
-- Se puede volver a aplicar las veces que haga falta: todo es `if not exists` y
-- al final están las sentencias que ponen AL DÍA una base que ya existía (hoy:
-- la cuarta columna del Kanban, el campo `pagado` y los tildes del taller). Por
-- eso `npm run schema` es también la migración, sin un segundo archivo de SQL
-- que se pueda olvidar.
--
-- Qué reemplaza cada tabla (antes vivía en localStorage de cada navegador):
--   configuracion    <- cotizador.config.v1   (colores en stock + precios)
--   cotizaciones     <- cotizador.proceso.v1  (las tarjetas del tablero)
--   cotizacion_items <- las líneas de cada tarjeta (antes dentro del JSON)
--   folios           <- Proceso.siguienteFolio() (ahora lo asigna el servidor)
--   usuarios/sesiones <- nuevo: identidad, para saber quién hizo qué
--   movimientos      <- bitácora de quién movió cada tarjeta y cuándo
--
-- El carrito en armado (cotizador.carrito.v1) NO se guarda aquí a propósito:
-- es un borrador personal y si fuese compartido dos personas se pisarían.

begin;

-- ---------------------------------------------------------------- Configuración
-- Una sola fila (`default`). El stock de colores y los precios son del negocio,
-- no de cada persona, así que van en un único registro compartido.
create table if not exists configuracion (
  id              text primary key default 'default',
  colores         jsonb not null default '[]'::jsonb,   -- [{id, nombre, hex}]
  precios         jsonb not null default '{}'::jsonb,   -- {nombre, nombreApellido}
  actualizada     timestamptz not null default now(),
  actualizada_por text
);

-- ------------------------------------------------------------------- Identidad
create table if not exists usuarios (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,          -- siempre en minúsculas
  nombre        text not null,                 -- lo que se sella en creada_por
  password_hash text not null,                 -- scrypt$16384$<salt b64>$<hash b64>
  activo        boolean not null default true,
  creado        timestamptz not null default now()
);

-- Sesiones: se guarda el SHA-256 del token, nunca el token en claro.
create table if not exists sesiones (
  token_hash text primary key,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  creada     timestamptz not null default now(),
  expira     timestamptz not null
);
create index if not exists sesiones_usuario_idx on sesiones (usuario_id);

-- ----------------------------------------------------------------------- Folio
-- Dispensador atómico: el folio lo asigna la base de datos, así que dos
-- personas cotizando al mismo tiempo jamás obtienen el mismo número.
create table if not exists folios (
  id     text primary key default 'default',
  ultimo integer not null default 0
);

create or replace function siguiente_folio() returns integer
language plpgsql as $$
declare n integer;
begin
  update folios set ultimo = ultimo + 1 where id = 'default' returning ultimo into n;
  if n is null then
    insert into folios (id, ultimo) values ('default', 1) returning ultimo into n;
  end if;
  return n;
end $$;

-- ------------------------------------------------------------------ Cotizaciones
-- Cada fila es una COPIA CONGELADA de la cotización tal como se envió: editar el
-- carrito después no cambia nada de lo guardado.
create table if not exists cotizaciones (
  id          uuid primary key default gen_random_uuid(),
  client_id   text unique,                       -- idempotencia: evita duplicados si se reintenta
  folio       integer not null unique,           -- lo asigna siguiente_folio()
  fecha       date not null default current_date,
  cliente     text not null default '',
  notas       text not null default '',
  columna     text not null default 'cotizacion' -- las cuatro columnas del Kanban
                check (columna in ('cotizacion', 'trabajo', 'realizado', 'entregado')),
  posicion    numeric not null default 1000,     -- lugar DENTRO de la columna: la nueva entra
                                                 -- arriba de «Cotización» y la que cambia de
                                                 -- columna entra abajo (ver api/functions/api.js)
  pagado      boolean not null default false,    -- se tilda solo al pasar a «Entregado»
  bases_listas  boolean not null default false,  -- el taller ya hizo las bases del clicker
  teclas_listas boolean not null default false,  -- y las teclas con su letra (ver la tarjeta)
  unidades    integer not null default 0,
  descuento   numeric(12,2) not null default 0,  -- pesos que se restan al subtotal de las líneas
  descuento_nota text not null default '',       -- de qué es: promo, ajuste, lo que sea
  total       numeric(12,2) not null default 0,  -- ya con el descuento: lo que se cobra
  creada      timestamptz not null default now(),
  movida      timestamptz not null default now(),
  creada_por  text,
  movida_por  text,
  borrada_en  timestamptz                        -- borrado suave: "Quitar" no destruye la historia
);
create index if not exists cotizaciones_tablero_idx on cotizaciones (columna, posicion)
  where borrada_en is null;
create index if not exists cotizaciones_cliente_idx on cotizaciones (cliente);
create index if not exists cotizaciones_fecha_idx   on cotizaciones (fecha);
create index if not exists cotizaciones_borrada_idx on cotizaciones (borrada_en);

-- Puesta al día de una base que ya estaba: este archivo se aplicó una vez, cuando
-- el tablero tenía tres columnas y no existía «Pagado». Las sentencias de abajo
-- son idempotentes a propósito, así `npm run schema` (documentado como
-- reaplicable) alcanza para migrar Neon y la base local, sin un segundo SQL.
-- Postgres nombra solo un check de columna: <tabla>_<columna>_check.
alter table cotizaciones add column if not exists pagado boolean not null default false;
-- Los tildes del taller: qué tandas del desglose de la tarjeta ya están hechas
-- (las bases del clicker y las teclas con su letra). Las tarjetas que ya estaban
-- quedan sin tildar, que es lo honesto: nadie dijo que estuvieran hechas.
alter table cotizaciones add column if not exists bases_listas boolean not null default false;
alter table cotizaciones add column if not exists teclas_listas boolean not null default false;
-- El descuento de la cotización (en pesos) y su motivo. `total` ya lo trae restado.
-- Las tarjetas que ya estaban quedan sin descuento.
alter table cotizaciones add column if not exists descuento numeric(12,2) not null default 0;
alter table cotizaciones add column if not exists descuento_nota text not null default '';
alter table cotizaciones drop constraint if exists cotizaciones_columna_check;
alter table cotizaciones add constraint cotizaciones_columna_check
  check (columna in ('cotizacion', 'trabajo', 'realizado', 'entregado'));

-- Líneas de cada cotización. En tabla (y no en un solo JSON) para poder reportar:
-- "cuántos llaveros se vendieron en marzo", "qué producto deja más margen", etc.
-- Los detalles del color sí van en JSON porque nunca se consultan por separado.
create table if not exists cotizacion_items (
  id            uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references cotizaciones(id) on delete cascade,
  orden         integer not null default 0,
  tipo          text not null default 'Producto',
  titulo        text not null,
  precio        numeric(12,2) not null default 0,  -- precio UNITARIO
  cantidad      integer not null default 1 check (cantidad > 0),
  detalles      jsonb not null default '[]'::jsonb -- [{label, nombre, hex}]
);
create index if not exists cotizacion_items_cot_idx on cotizacion_items (cotizacion_id, orden);

-- -------------------------------------------------------------------- Bitácora
create table if not exists movimientos (
  id            bigserial primary key,
  cotizacion_id uuid not null references cotizaciones(id) on delete cascade,
  de_columna    text,
  a_columna     text,
  usuario       text,
  cuando        timestamptz not null default now()
);
create index if not exists movimientos_cot_idx on movimientos (cotizacion_id, cuando desc);

-- ---------------------------------------------------------------------- Semilla
insert into configuracion (id) values ('default') on conflict (id) do nothing;
insert into folios (id, ultimo) values ('default', 0) on conflict (id) do nothing;

commit;

-- Comprobación rápida: debe listar las 7 tablas.
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;

