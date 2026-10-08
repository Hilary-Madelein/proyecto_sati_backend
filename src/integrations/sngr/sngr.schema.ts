import { z } from 'zod';

/** Cantidades que llegan como texto ("4", "0.00"), vacías o nulas: se tratan como 0. */
const count = z.unknown().transform((value) => {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
});

/** "Nivel 2" -> 2. Null si no trae un número. */
const eventLevel = z.unknown().transform((value) => {
  const match = /\d+/.exec(String(value ?? ''));
  return match ? Number(match[0]) : null;
});

const optionalText = z
  .unknown()
  .transform((value) => (value === null || value === undefined ? null : String(value).trim() || null));

/** Número o texto numérico; null si está vacío o no es un número. */
const optionalNumber = z.unknown().transform((value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
});

/**
 * Fecha de la SNGR a AAAA-MM-DD. Llega como día/mes/año sin ceros ("2/9/2026"
 * es 2 de septiembre); también se acepta AAAA-MM-DD. Null si no es una fecha real.
 */
export function toIsoDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dmy
      ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])]
      : [NaN, NaN, NaN];

  // Rechaza fechas imposibles (31/9) en vez de dejar que Date las corra al mes siguiente.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Registro de `POST /public/eventos_lluvias`. Es tolerante a propósito (números
 * como texto, campos vacíos) y conserva los campos que no se usan en `raw`.
 * Significado de cada campo: diccionario de variables de la SNGR.
 *
 * La API no entrega un identificador del evento (ver `sngrEventId`).
 */
export const sngrEventSchema = z.looseObject({
  /** Nombre del evento según el catálogo de la SNGR: "Inundación", "Deslizamiento", "Vendaval"… */
  Evento: optionalText,
  /** Nivel oficial del evento: "Nivel 1", "Nivel 2", "Nivel 3"… */
  NivelDelEvento: eventLevel,
  /** "Seguimiento" mientras sigue abierto; "Cierre" cuando está cerrado. */
  EstadoDelEvento: optionalText,
  FechaDelEvento: z.unknown().transform(toIsoDate),
  /** "HH:MM", a veces sin cero inicial ("9:40"). */
  HoraDelEvento: z.unknown().optional(),
  Latitud: optionalNumber,
  Longitud: optionalNumber,
  /** "lat,lng": respaldo si Latitud/Longitud vienen vacías. */
  Coordenadas: optionalText,
  Provincia: optionalText,
  Canton: optionalText,
  Parroquia: optionalText,
  /** Código de seis dígitos de la parroquia (INEC). */
  CodificacionParroquial: optionalText,
  'Comunidad/Barrio/Sector': optionalText,
  DescripcionGeneralDeEvento: optionalText,
  PersonasAfectadasDirectamente: count,
  ViviendasAfectadas: count,
  PersonasEvacuadas: count,
  PersonasFallecidas: count,
});

export type SngrEvent = z.infer<typeof sngrEventSchema>;

/** Respuesta de `POST /usuarios/login`. Trae además descripcion, id y usuario, que no se usan. */
export const sngrLoginResponseSchema = z.looseObject({
  success: z.boolean().optional(),
  token: z.string().min(1).optional(),
});

/** Respuesta de `POST /public/eventos_lluvias`. */
export const sngrEventsResponseSchema = z.looseObject({
  success: z.boolean().optional(),
  count: z.number().optional(),
  data: z.array(z.unknown()),
});
