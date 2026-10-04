import { toTitleCase } from '../../common/text/title-case.js';
import { parseEcuadorDateTime } from '../../common/time/ecuador-time.js';
import { HAZARD_TYPES, type HazardType } from '../../modules/events/domain/hazard-type.js';
import type { NormalizedEvent } from '../../modules/events/domain/normalized-event.js';
import type { Severity } from '../../modules/events/domain/severity.js';
import { SNGR_EVENT_TYPES, sngrEventSchema } from './sngr.schema.js';

export const SNGR_SOURCE_KEY = 'sngr';

const HAZARD_BY_SNGR_TYPE = new Map<number, HazardType>(
  Object.entries(SNGR_EVENT_TYPES).map(([hazard, code]) => [code, hazard as HazardType]),
);

/**
 * Severidad a partir del nivel oficial de la SNGR (NivelDeEvento):
 * Nivel 3 o más → crítico, Nivel 2 → alto, Nivel 1 o sin nivel → moderado.
 */
export function severityFromSngrLevel(level: number | null): Severity {
  if (level !== null && level >= 3) return 'critical';
  if (level === 2) return 'high';
  return 'moderate';
}

/** Recuadro amplio de Ecuador, incluidas Galápagos: descarta coordenadas vacías (0,0) o erróneas. */
const isInEcuador = (lat: number, lng: number) => lat >= -6 && lat <= 2.5 && lng >= -92.5 && lng <= -75;

export type SngrMapResult = { ok: true; event: NormalizedEvent } | { ok: false; reason: string };

/** Traduce un registro de la SNGR al modelo propio, o explica por qué se descarta. */
export function mapSngrEvent(raw: unknown): SngrMapResult {
  const parsed = sngrEventSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'formato inválido' };
  const record = parsed.data;

  const occurredAt = parseEcuadorDateTime(record.FechaDelEvento, record.HoraDelEvento);
  if (!occurredAt) return { ok: false, reason: 'fecha inválida' };
  if (!isInEcuador(record.Latitud, record.Longitud)) return { ok: false, reason: 'coordenadas fuera de Ecuador' };

  const hazardType = HAZARD_BY_SNGR_TYPE.get(record.TipoEventoID) ?? 'other';
  const province = toTitleCase(record.Provincia) || null;
  const canton = toTitleCase(record.Canton) || null;

  return {
    ok: true,
    event: {
      source: SNGR_SOURCE_KEY,
      externalId: String(record.EventoID),
      code: record.CodigoEvento,
      hazardType,
      severity: severityFromSngrLevel(record.NivelDeEvento),
      level: record.NivelDeEvento,
      status: record.Estado?.toLowerCase() === 'cierre' ? 'closed' : 'open',
      title: canton ? `${HAZARD_TYPES[hazardType]} en ${canton}` : HAZARD_TYPES[hazardType],
      description: record.Descripcion,
      province,
      canton,
      sector: record.Sector,
      latitude: record.Latitud,
      longitude: record.Longitud,
      occurredAt,
      impact: {
        affected: record.PersonasAfectadasDirectamente,
        housesAffected: record.ViviendasAfectadas,
        evacuated: record.PersonasEvacuadas,
        deceased: record.PersonasFallecidas,
      },
      raw,
    },
  };
}
