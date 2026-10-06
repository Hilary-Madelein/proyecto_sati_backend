import { z } from 'zod';

/** "a, b ,c" -> ["a", "b", "c"] */
const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

/**
 * Puertos que la especificación de `fetch` prohíbe (navegadores y Node los
 * rechazan con "bad port"). Ver https://fetch.spec.whatwg.org/#port-blocking
 */
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** "true" / "false" -> boolean, con valor por defecto. */
const booleanFlag = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

/**
 * Variables de entorno de la aplicación. Se validan al arrancar: si falta una
 * obligatoria o tiene un formato inválido, el servidor no inicia y dice cuál.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** No usar puertos que `fetch` bloquea (p. ej. 6000): el frontend no podría conectarse. */
  PORT: z.coerce
    .number()
    .int()
    .positive()
    .default(4000)
    .refine((port) => !FETCH_BLOCKED_PORTS.has(port), {
      message: 'puerto bloqueado por fetch en navegadores y Node ("bad port"); usa otro, p. ej. 4000',
    }),
  /** Orígenes que pueden llamar a la API desde el navegador (el frontend). */
  CORS_ORIGINS: commaList,

  /** Dónde se guardan los datos: "memory" (sin BD, se pierden al reiniciar) o "postgres". */
  STORAGE: z.enum(['memory', 'postgres']).default('memory'),
  /**
   * Con STORAGE=memory: carpeta donde se guarda una copia de los datos para que
   * sobrevivan a los reinicios (p. ej. al guardar un archivo en desarrollo).
   * Vacío = no guardar.
   */
  MEMORY_PERSIST_DIR: z.string().default('.data'),
  /** Obligatoria solo con STORAGE=postgres. */
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .optional()
    .or(z.literal('').transform(() => undefined)),
  DATABASE_SSL: booleanFlag(false),

  /** Ingesta: consultar todas las fuentes al arrancar, además de en su intervalo. */
  INGESTION_RUN_ON_STARTUP: booleanFlag(true),
  /**
   * Token para automatizaciones (p. ej. un cron externo que lance POST /ingestion/...).
   * No es una contraseña de personas: el panel usa cuentas con correo y contraseña.
   * Vacío = deshabilitado.
   */
  ADMIN_TOKEN: z.string().min(24).optional().or(z.literal('').transform(() => undefined)),
  /** Horas que dura una sesión del panel de administración. */
  ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(8),

  // ── SNGR: eventos por lluvias (API de monitoreo del COE) ──────────────────
  SNGR_ENABLED: booleanFlag(true),
  /** Inicio de sesión: usuario y clave → token JWT. */
  SNGR_LOGIN_URL: z.url().default('https://monitoreocoe.gestionderiesgos.gob.ec/api/usuarios/login'),
  /** Consulta de eventos por lluvias (token + rango de fechas). */
  SNGR_EVENTS_URL: z.url().default('https://monitoreocoe.gestionderiesgos.gob.ec/api/public/eventos_lluvias'),
  /** Credenciales de la API. Obligatorias solo si SNGR_ENABLED=true. */
  SNGR_USUARIO: z.string().default(''),
  SNGR_CLAVE: z.string().default(''),
  SNGR_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SNGR_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(15),
  /**
   * Días hacia atrás que se consultan en cada sincronización. Se relee toda la
   * ventana para captar cambios de eventos ya conocidos (p. ej. Seguimiento → Cierre).
   */
  SNGR_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // ── Capas WMS (GeoServer del INAMHI servido por GeoGLOWS) ────────────────
  GEOGLOWS_WRF_WMS_URL: z.url().default('http://services.geoglows.org:8080/geoserver/wrf/wms'),
  /** Mismo servidor por WCS: descarga de la lluvia en grilla para calcular acumulados. */
  GEOGLOWS_WRF_WCS_URL: z.url().default('http://services.geoglows.org:8080/geoserver/wrf/wcs'),
  SATELLITE_PRECIPITATION_WMS_URL: z
    .url()
    .default('http://services.geoglows.org:8080/geoserver/satellite_based_precipitation/wms'),
  /** Mismo servidor por WCS: lluvia horaria en grilla para calcular las últimas 24/48/72 h. */
  SATELLITE_PRECIPITATION_WCS_URL: z
    .url()
    .default('http://services.geoglows.org:8080/geoserver/satellite_based_precipitation/wcs'),

  // ── Notificaciones por correo (SMTP) ─────────────────────────────────────
  /** Servidor SMTP (p. ej. smtp.gmail.com, smtp-relay.brevo.com). Vacío = los correos solo van al log. */
  SMTP_HOST: z.string().optional().or(z.literal('').transform(() => undefined)),
  /** 587 con STARTTLS (SMTP_SECURE=false) o 465 con TLS (SMTP_SECURE=true). */
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanFlag(false),
  /** Credenciales del servidor de correo (secretas: solo en .env). */
  SMTP_USER: z.string().optional().or(z.literal('').transform(() => undefined)),
  SMTP_PASS: z.string().optional().or(z.literal('').transform(() => undefined)),
  /** Remitente, p. ej. "SATI.EC <alertas@ejemplo.ec>". Obligatorio si hay SMTP_HOST. */
  MAIL_FROM: z.string().optional().or(z.literal('').transform(() => undefined)),
  /** Dirección pública del mapa, para el enlace "Ver en el mapa" de los correos. */
  APP_PUBLIC_URL: z.url().optional().or(z.literal('').transform(() => undefined)),

  // ── Caudales ─────────────────────────────────────────────────────────────
  /** API pública de GEOGLOWS (pronóstico de caudal por tramo de río). */
  GEOGLOWS_API_URL: z.url().default('https://geoglows.ecmwf.int/api/v2'),
  /** Servidor de teselas del Hydroviewer del INAMHI (red de ríos y alertas). */
  HYDROVIEWER_TILES_URL: z.url().default('https://services.geoglows.org/martin'),

  // ── Temperatura del mar (NOAA OISST, ERDDAP de CoastWatch) ───────────────
  /** Dataset en tiempo casi real (~1 día de retraso), sin el sufijo del formato. La versión "final" llega ~15 días tarde. */
  OISST_ERDDAP_URL: z.url().default('https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21NrtAgg_LonPM180'),
}).superRefine((env, ctx) => {
  if (env.STORAGE === 'postgres' && !env.DATABASE_URL) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'obligatoria cuando STORAGE=postgres' });
  }
  if (env.SMTP_HOST && !env.MAIL_FROM) {
    ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'obligatorio cuando hay SMTP_HOST' });
  }
  if (env.SMTP_USER && !env.SMTP_PASS) {
    ctx.addIssue({ code: 'custom', path: ['SMTP_PASS'], message: 'obligatoria cuando hay SMTP_USER' });
  }
  if (!env.SNGR_ENABLED) return;
  for (const key of ['SNGR_USUARIO', 'SNGR_CLAVE'] as const) {
    if (!env[key]) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'obligatoria cuando SNGR_ENABLED=true' });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

/** Usado por ConfigModule: devuelve las variables ya tipadas o lanza un error legible. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return result.data;
}
