import { stableHash } from '../../common/crypto/stable-hash.js';
import { toTitleCase } from '../../common/text/title-case.js';
import { normalizeTime, parseEcuadorDateTime } from '../../common/time/ecuador-time.js';
import { HAZARD_TYPES } from '../../modules/events/domain/hazard-type.js';
import type { NormalizedEvent } from '../../modules/events/domain/normalized-event.js';
import type { Severity } from '../../modules/events/domain/severity.js';
import { floodTypeFromSngrEvent, impactLevelFromSngrEvent, waterBodyFromDescription } from './sngr-flood.classifier.js';
import { sngrEventSchema, type SngrEvent } from './sngr.schema.js';

export const SNGR_SOURCE_KEY = 'sngr';

/** Motivo de descarte de lo que no es una inundación: no es un error de los datos. */
export const NOT_A_FLOOD = 'no es inundación';

/** "Inundación " -> "inundacion": sin tildes, minúsculas y sin espacios sobrantes. */
const normalizeName = (value: string) =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** "Río Balao" -> "del río Balao"; "Quebrada Higuerillas" -> "de la quebrada Higuerillas". */
function waterBodyWithArticle(waterBody: string): string {
  const [kind, ...name] = waterBody.split(' ');
  const article = kind === 'Quebrada' ? 'de la' : 'del';
  return `${article} ${kind.toLowerCase()} ${name.join(' ')}`;
}

/**
 * Severidad a partir del nivel oficial de la SNGR (NivelDelEvento):
 * Nivel 3 o más → crítico, Nivel 2 → alto, Nivel 1 o sin nivel → moderado.
 */
export function severityFromSngrLevel(level: number | null): Severity {
  if (level !== null && level >= 3) return 'critical';
  if (level === 2) return 'high';
  return 'moderate';
}

/**
 * La API no entrega un identificador, así que se arma uno con lo que identifica
 * al evento y no cambia durante su seguimiento: parroquia, tipo, fecha, hora y
 * coordenadas. La descripción, el estado y las cifras sí cambian y no entran.
 * Si la SNGR corrige alguno de estos datos, el evento corregido se guarda como nuevo.
 */
export function sngrEventId(record: SngrEvent, latitude: number, longitude: number): string {
  return stableHash([
    record.CodificacionParroquial ?? normalizeName(record.Parroquia ?? ''),
    normalizeName(record.Evento ?? ''),
    record.FechaDelEvento,
    normalizeTime(record.HoraDelEvento),
    latitude,
    longitude,
  ]).slice(0, 32);
}

/** Recuadro amplio de Ecuador, incluidas Galápagos: descarta coordenadas vacías (0,0) o erróneas. */
const isInEcuador = (lat: number, lng: number) => lat >= -6 && lat <= 2.5 && lng >= -92.5 && lng <= -75;

/** Latitud/Longitud; si faltan, el campo "Coordenadas" ("lat,lng"). */
function coordinatesOf(record: SngrEvent): [number, number] | null {
  if (record.Latitud !== null && record.Longitud !== null) return [record.Latitud, record.Longitud];
  const [lat, lng] = (record.Coordenadas ?? '').split(',').map((part) => Number.parseFloat(part));
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

export type SngrMapResult = { ok: true; event: NormalizedEvent } | { ok: false; reason: string };

/** Traduce un registro de la SNGR al modelo propio, o explica por qué se descarta. */
export function mapSngrEvent(raw: unknown): SngrMapResult {
  const parsed = sngrEventSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'formato inválido' };
  const record = parsed.data;

  const occurredAt = record.FechaDelEvento && parseEcuadorDateTime(record.FechaDelEvento, record.HoraDelEvento);
  if (!occurredAt) return { ok: false, reason: 'fecha inválida' };
  const coordinates = coordinatesOf(record);
  if (!coordinates || !isInEcuador(...coordinates)) return { ok: false, reason: 'coordenadas fuera de Ecuador' };
  const [latitude, longitude] = coordinates;

  // Solo interesan las inundaciones (desbordes de ríos y lluvia que anega): los
  // deslizamientos, vendavales, granizadas… se descartan.
  const hazardType = floodTypeFromSngrEvent(record);
  if (!hazardType) return { ok: false, reason: NOT_A_FLOOD };
  const waterBody = hazardType === 'river_flood' ? waterBodyFromDescription(record.DescripcionGeneralDeEvento) : null;
  const label = waterBody ? `Desborde ${waterBodyWithArticle(waterBody)}` : HAZARD_TYPES[hazardType];
  const province = toTitleCase(record.Provincia) || null;
  const canton = toTitleCase(record.Canton) || null;

  return {
    ok: true,
    event: {
      source: SNGR_SOURCE_KEY,
      externalId: sngrEventId(record, latitude, longitude),
      code: null,
      hazardType,
      severity: severityFromSngrLevel(record.NivelDelEvento),
      level: record.NivelDelEvento,
      status: record.EstadoDelEvento?.toLowerCase() === 'cierre' ? 'closed' : 'open',
      title: canton ? `${label} en ${canton}` : label,
      description: record.DescripcionGeneralDeEvento,
      province,
      canton,
      sector: record['Comunidad/Barrio/Sector'],
      waterBody,
      impactLevel: impactLevelFromSngrEvent(record),
      latitude,
      longitude,
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
