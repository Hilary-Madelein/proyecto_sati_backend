# SATI.EC · API

Backend del Sistema de alerta temprana de inundaciones para el Ecuador. Reúne datos
de fuentes externas (SNGR, INAMHI, …), los guarda en PostgreSQL + PostGIS y los
expone al frontend. También detecta eventos nuevos o que se agravan para enviar alertas.

NestJS 12 (ESM) · TypeORM · PostgreSQL 14+ con PostGIS · Node 24.

## Puesta en marcha (local)

Requisito: Node 24 (`nvm use`). La base de datos es opcional.

```bash
# crea .env con SNGR_USUARIO y SNGR_CLAVE (y ADMIN_TOKEN si lo usarás)
npm install
npm run start:dev
```

### Almacenamiento (`STORAGE`)

- `memory` (por defecto): sin base de datos. Los eventos se guardan en memoria y se
  pierden al reiniciar; la ingesta los vuelve a cargar al arrancar.
- `postgres`: PostgreSQL + PostGIS. Las migraciones se aplican solas al arrancar.
  Preparación en Ubuntu con PostgreSQL 14 (una sola vez):

  ```bash
  sudo apt install postgresql-14-postgis-3
  sudo -u postgres psql -c "CREATE ROLE sati LOGIN PASSWORD 'sati_dev'" -c "CREATE DATABASE sati OWNER sati"
  sudo -u postgres psql -d sati -c "CREATE EXTENSION IF NOT EXISTS postgis" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
  ```

  y en `.env`: `STORAGE=postgres` y `DATABASE_URL=...`.

El dominio solo depende de los contratos `EventStore`, `SyncRunStore` y `SourceLock`;
`src/storage/memory` y `src/storage/postgres` los implementan.

- API: <http://localhost:4000/api/v1>
- Documentación interactiva (Swagger): <http://localhost:4000/api/docs>

En cada sincronización se consultan los últimos `SNGR_BACKFILL_DAYS` días de la SNGR
(API de eventos por lluvias: login con usuario y clave → token → consulta por fechas).

## Arquitectura

```
src/
├── config/            Variables de entorno validadas al arrancar (zod)
├── common/            Utilidades sin dominio: HTTP con reintentos, hora de Ecuador, WMS, …
├── storage/           Almacenamiento intercambiable: memory/ y postgres/ (según STORAGE)
├── database/          Opciones y migraciones de PostgreSQL
├── modules/           Dominio propio (no conoce a ninguna API externa)
│   ├── events/        Eventos normalizados: BD, severidad, API REST, avisos internos
│   ├── ingestion/     Descubre las fuentes, las programa y guarda cada sincronización
│   ├── map-layers/    Capas WMS y teselas vectoriales: disponibilidad, leyenda y proxy seguro
│   ├── hydrology/     Caudales de ríos: alertas por periodo de retorno e hidrogramas
│   ├── rain-forecast/ Lluvia pronosticada del WRF en tramos de 24 h (0–24, 24–48, 48–72 h)
│   ├── notifications/ Regla de alertas y canales de envío (log hoy, correo después)
│   └── health/        Estado del servicio y la BD
└── integrations/      Un adaptador por API externa
    ├── sngr/                     Eventos adversos de la SNGR
    ├── inamhi-wrf/               Lluvia pronosticada del modelo WRF (INAMHI, GeoServer de GeoGLOWS)
    ├── satellite-precipitation/  Lluvia observada por satélite (PERSIANN): horaria por WCS
    ├── geoglows/                 API pública de GEOGLOWS: río más cercano y pronóstico de caudal
    └── inamhi-hydroviewer/       Hydroviewer del INAMHI: red de ríos y alertas por caudal
```

**Flujo de un evento:**

```
SNGR ──► SngrEventSource ──► IngestionService ──► EventsService ──► PostgreSQL
         (traduce a           (programa, bloqueo   (inserta / actualiza,     │
          NormalizedEvent)     por fuente, bitácora) calcula severidad)       │
                                                         │                    ▼
                                    aviso "hazard-event.created/updated"   GET /events
                                                         ▼
                                              NotificationsService ──► canales (log, correo…)
```

Principios:

- **El dominio no depende de las fuentes.** Todo entra como `NormalizedEvent`; la API,
  la base de datos y las alertas son las mismas venga de donde venga el dato.
- **Las extensiones se descubren solas.** Las fuentes de eventos (`@HazardEventSource()`),
  las capas (`@MapLayerProvider()`) y los canales de notificación (`@NotificationChannel()`)
  se registran con un decorador; no hay listas que mantener a mano.
- **Módulos desacoplados por avisos internos.** La ingesta no sabe que existen las
  notificaciones: solo se emite `hazard-event.created` y quien quiera lo escucha.
- **Listo para varias instancias.** Cada fuente se sincroniza con un bloqueo de
  PostgreSQL (`pg_try_advisory_lock`), así dos réplicas nunca consultan la misma
  fuente a la vez.
- **Seguridad.** Las credenciales solo existen en `.env`; el proxy WMS no acepta
  URLs del cliente (el servidor y la capa los fija el backend).

## Cómo agregar una API nueva

### Una fuente de eventos (como la SNGR)

1. Crea `src/integrations/<nombre>/` con:
   - `<nombre>.client.ts`: llamadas HTTP (usa `fetchWithRetry`).
   - `<nombre>.schema.ts`: validación de la respuesta con zod.
   - `<nombre>.mapper.ts`: traduce cada registro a `NormalizedEvent`.
   - `<nombre>-event.source.ts`: clase con `@HazardEventSource()` que implementa
     `HazardEventSourceAdapter` (su `descriptor` y `fetchEvents(window)`).
   - `<nombre>.module.ts`: registra el cliente y la fuente como providers.
2. Agrega sus variables a `src/config/env.schema.ts` y a `.env.example`.
3. Importa el módulo en `src/app.module.ts`.

Listo: la ingesta la programa, sus eventos aparecen en `GET /events` y disparan alertas.

### Una capa de mapa WMS

Crea una clase con `@MapLayerProvider()` que devuelva sus `MapLayerDefinition`
(ver `integrations/inamhi-wrf/wrf-layers.provider.ts`) e importa su módulo. Queda
disponible en `GET /layers`, `/layers/:id`, `/layers/:id/legend` y `/layers/:id/wms`.

### Un canal de notificación (p. ej. correo)

Crea una clase con `@NotificationChannel()` que implemente `NotificationChannelAdapter`
(`send(alert)`) y regístrala en `NotificationsModule`. Recibirá todas las alertas.

### Otro proveedor de caudales

`hydrology` define dos contratos (`RiverForecastSource`, `RiverAlertSource`). Hoy los
cumplen `geoglows` (pronóstico) e `inamhi-hydroviewer` (alertas); otro proveedor solo
tiene que implementarlos en su módulo de `integrations/`.

### Otro tipo de dato

Crea un módulo nuevo en `src/modules/` con su servicio y controlador, y sigue el mismo
patrón: un contrato para sus fuentes y adaptadores en `integrations/`.

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/events` | Eventos con filtros (`from`, `to`, `province`, `hazardType`, `severity`, `status`, `bbox`, `limit`, `offset`) |
| GET | `/api/v1/events/summary` | Totales por severidad, tipo y provincia, e impacto |
| GET | `/api/v1/events/:id` | Detalle de un evento |
| GET | `/api/v1/layers` | Capas de mapa disponibles |
| GET | `/api/v1/layers/:id` | Pasos de tiempo, corrida del modelo y si está atrasado |
| GET | `/api/v1/layers/:id/legend` | Rampa de colores real |
| GET | `/api/v1/layers/:id/wms` | Proxy WMS (úsalo como URL de la capa en Leaflet) |
| GET | `/api/v1/layers/:id/tiles/:z/:x/:y` | Proxy de teselas vectoriales (red de ríos) |
| GET | `/api/v1/rain-forecast` | Corrida vigente del WRF y días disponibles (1, 2, 3) |
| GET | `/api/v1/rain-forecast/days/:day` | Lluvia de un solo día: ventana, límites, máximo y ruta de la imagen |
| GET | `/api/v1/rain-forecast/days/:day/image` | Imagen PNG de la lluvia del día para superponer en el mapa |
| GET | `/api/v1/observed-rain` | Lluvia observada por satélite: última hora y ventanas 24/48/72 h por producto |
| GET | `/api/v1/observed-rain/:product/accumulated/:hours` | Lluvia observada hasta la última hora: ventana, máximo y ruta de la imagen |
| GET | `/api/v1/observed-rain/:product/accumulated/:hours/image` | Imagen PNG de la lluvia observada acumulada |
| GET | `/api/v1/rivers/alerts` | Tramos con alerta por caudal, por día del último pronóstico (14 días) |
| GET | `/api/v1/rivers/at?lat=&lng=` | Tramo de río más cercano a un punto y su alerta |
| GET | `/api/v1/rivers/:riverId/forecast` | Pronóstico de caudal (ensamble y alta resolución, 15 días) |
| GET | `/api/v1/ingestion/sources` | Fuentes y su última sincronización |
| GET | `/api/v1/ingestion/runs` | Historial de sincronizaciones |
| POST | `/api/v1/ingestion/sources/:key/run` | Sincronización manual (cabecera `x-admin-token`) |
| GET | `/api/v1/health` | Estado del servicio y la BD |

## Severidad de los eventos

Cada fuente traduce su propia escala a la severidad del sistema. La SNGR usa su nivel
oficial (`NivelDelEvento`), en `src/integrations/sngr/sngr.mapper.ts`:

- **Crítico**: Nivel 3 o superior.
- **Alto**: Nivel 2.
- **Moderado**: Nivel 1 o sin nivel.

El nivel original también se guarda y se expone (`level`).

Se alerta solo por eventos **abiertos**, **críticos o altos** y ocurridos en las **últimas 48 h**
(así la carga inicial no dispara avisos por eventos antiguos), o cuando un evento sube de severidad.

## Scripts

| Comando | Para qué |
|---|---|
| `npm run start:dev` | Desarrollo con recarga |
| `npm run build` / `npm run start:prod` | Compilar y ejecutar en producción |
| `npm test` | Tests unitarios (Vitest) |
| `npm run lint` | Linter (oxlint) |
| `npm run migration:run` | Aplicar migraciones manualmente |
| `npm run migration:create -- src/database/migrations/<Nombre>` | Crear una migración nueva (y agregarla a `database.options.ts`) |

## Despliegue

Pendiente de definir el servidor.

## Lluvia pronosticada día por día

El WRF del INAMHI publica la lluvia **de cada día** por separado. El backend entrega un día
a la vez (día 1 = 0–24 h, 2 = 24–48 h, 3 = 48–72 h), **sin sumarlos**.

1. Descarga la lluvia del día en grilla por WCS (GeoTIFF, ~3 km) de la última corrida.
2. Pinta un PNG con la paleta oficial de la capa (GetLegendGraphic), suavizado, recortado
   al Ecuador y reproyectado a Web Mercator (`common/raster/render-png.ts`).
3. Lo cachea por corrida: no cambia hasta que el INAMHI publique una corrida nueva.

Si la corrida no llega a un día (p. ej. el día 3), ese día aparece como no disponible.

