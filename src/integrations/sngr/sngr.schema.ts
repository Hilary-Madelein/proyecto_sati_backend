import { z } from 'zod';

/** Cantidades que a veces llegan como texto, vacías o nulas: se tratan como 0. */
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

/**
 * Registro de evento del web service de la SNGR. Es tolerante a propósito
 * (números como texto, campos vacíos) y conserva los campos que no se usan.
 */
export const sngrEventSchema = z.looseObject({
  EventoID: z.coerce.number().int().positive(),
  CodigoEvento: optionalText,
  TipoEventoID: z.coerce.number().int(),
  /** Nivel oficial del evento: "Nivel 1", "Nivel 2", "Nivel 3"… */
  NivelDeEvento: eventLevel,
  /** AAAA-MM-DD (a veces con hora detrás). */
  FechaDelEvento: z
    .string()
    .trim()
    .transform((value) => value.slice(0, 10)),
  /** "HH:MM", a veces sin cero inicial ("9:40"). */
  HoraDelEvento: z.unknown().optional(),
  Latitud: z.coerce.number(),
  Longitud: z.coerce.number(),
  Provincia: optionalText,
  Canton: optionalText,
  Sector: optionalText,
  /** "Cierre" cuando el evento está cerrado; "Seguimiento" mientras sigue abierto. */
  Estado: optionalText,
  Descripcion: optionalText,
  PersonasAfectadasDirectamente: count,
  ViviendasAfectadas: count,
  PersonasEvacuadas: count,
  PersonasFallecidas: count,
});

export type SngrEvent = z.infer<typeof sngrEventSchema>;

/** Códigos de tipo de evento de la SNGR (TipoEventoID) relacionados con lluvias. */
export const SNGR_EVENT_TYPES = {
  flood: 1262,
  landslide: 1060,
  heavy_rain: 5589,
  mudflow: 1053,
  subsidence: 1065,
  water_erosion: 5586,
  rockfall: 5584,
  soil_creep: 5585,
} as const;
