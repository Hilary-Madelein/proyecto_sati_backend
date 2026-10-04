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
  PORT: z.coerce.number().int().positive().default(5000),
  /** Orígenes que pueden llamar a la API desde el navegador (el frontend). */
  CORS_ORIGINS: commaList,

  /** Dónde se guardan los datos: "memory" (sin BD, se pierden al reiniciar) o "postgres". */
  STORAGE: z.enum(['memory', 'postgres']).default('memory'),
  /** Obligatoria solo con STORAGE=postgres. */
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .optional()
    .or(z.literal('').transform(() => undefined)),
  DATABASE_SSL: booleanFlag(false),

  /** Ingesta: consultar todas las fuentes al arrancar, además de en su intervalo. */
  INGESTION_RUN_ON_STARTUP: booleanFlag(true),
  /** Token para lanzar sincronizaciones manuales (POST /ingestion/...). Vacío = deshabilitado. */
  ADMIN_TOKEN: z.string().min(24).optional().or(z.literal('').transform(() => undefined)),

  // ── SNGR: eventos adversos ───────────────────────────────────────────────
  SNGR_ENABLED: booleanFlag(true),
  SNGR_URL: z.url(),
  /** Credencial del web service. Obligatoria solo si SNGR_ENABLED=true. */
  SNGR_TOKEN: z.string().default(''),
  SNGR_USUARIO: z.string().default(''),
  /** La SNGR tarda ~15 s y a veces más de 30 s. */
  SNGR_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SNGR_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(15),
  /** Días hacia atrás que se cargan la primera vez (cuando la BD está vacía). */
  SNGR_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // ── Capas WMS (GeoServer del INAMHI servido por GeoGLOWS) ────────────────
  GEOGLOWS_WRF_WMS_URL: z.url().default('http://services.geoglows.org:8080/geoserver/wrf/wms'),
  SATELLITE_PRECIPITATION_WMS_URL: z
    .url()
    .default('http://services.geoglows.org:8080/geoserver/satellite_based_precipitation/wms'),

  // ── Caudales ─────────────────────────────────────────────────────────────
  /** API pública de GEOGLOWS (pronóstico de caudal por tramo de río). */
  GEOGLOWS_API_URL: z.url().default('https://geoglows.ecmwf.int/api/v2'),
  /** Servidor de teselas del Hydroviewer del INAMHI (red de ríos y alertas). */
  HYDROVIEWER_TILES_URL: z.url().default('https://services.geoglows.org/martin'),
}).superRefine((env, ctx) => {
  if (env.STORAGE === 'postgres' && !env.DATABASE_URL) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'obligatoria cuando STORAGE=postgres' });
  }
  if (!env.SNGR_ENABLED) return;
  for (const key of ['SNGR_TOKEN', 'SNGR_USUARIO'] as const) {
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
