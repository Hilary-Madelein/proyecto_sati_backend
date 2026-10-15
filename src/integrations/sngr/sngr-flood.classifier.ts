import type { HazardType, ImpactLevel } from '../../modules/events/domain/hazard-type.js';
import type { SngrEvent } from './sngr.schema.js';

/**
 * La SNGR registra casi todas las inundaciones como "Inundación" a secas, aunque
 * su catálogo distingue fluvial, pluvial y costera, y en `Causa` suele poner
 * "Lluvias intensas" aunque luego se haya desbordado un río. El origen real del
 * agua solo aparece en el relato (`DescripcionGeneralDeEvento`), así que se lee de ahí.
 * Si algún día llega el subtipo del catálogo, se usa ese.
 */
export type FloodType = Extract<
  HazardType,
  'river_flood' | 'rain_flood' | 'drainage_flood' | 'coastal_flood' | 'flood'
>;

/** "Inundación " -> "inundacion": sin tildes, minúsculas y sin espacios sobrantes. */
const plain = (value: string | null) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const FLOOD_BY_SUBTYPE: Readonly<Record<string, FloodType>> = {
  'inundacion fluvial': 'river_flood',
  'inundacion pluvial': 'rain_flood',
  'inundacion costera': 'coastal_flood',
  'inundacion lacustre': 'flood',
};

/** Tipos de la SNGR que a veces describen agua desbordada o acumulada. */
const WATER_RELATED_EVENTS = ['lluvias intensas', 'aluvion', 'erosion hidrica'];

const WATER_BODY = String.raw`(rio|rios|estero|esteros|quebrada|quebradas|riachuelo|afluente|cauce|cuerpo hidrico|cuerpos? de agua)`;
const HAS_WATER_BODY = new RegExp(String.raw`\b${WATER_BODY}\b`);
const OVERFLOW = /desbord|salio de su cauce|rebos/;
const RISE = /crecid|caudal|(incremento|aumento|subida|crecimiento) (del|de su|de los?) (nivel|rio|estero|quebrada)/;
const DRAINAGE = /alcantarill|sumidero|taponamiento|colapso del sistema|drenaje|rejilla|aguas servidas/;
const COASTAL = /oleaje|aguaje|marea alta|\bmar\b/;
const STANDING_WATER = /inunda|anega|acumulacion de aguas?|ingreso de agua|aguas? lluvias?|empoz|encharc/;

/** Tipo de inundación, o null si el registro no es una inundación (deslizamiento, vendaval…). */
export function floodTypeFromSngrEvent(
  record: Pick<SngrEvent, 'Evento' | 'Causa' | 'DescripcionGeneralDeEvento'>,
): FloodType | null {
  const event = plain(record.Evento)
    .replace(/\(.*?\)/g, '')
    .trim();
  const isFlood = event.startsWith('inundacion');
  if (!isFlood && !WATER_RELATED_EVENTS.includes(event)) return null;
  if (FLOOD_BY_SUBTYPE[event]) return FLOOD_BY_SUBTYPE[event];

  const text = plain(record.DescripcionGeneralDeEvento);
  const cause = plain(record.Causa);
  const riverOverflow = cause.includes('desbordamiento') || (HAS_WATER_BODY.test(text) && OVERFLOW.test(text));
  // En una "Inundación", que el río crezca basta; en los demás tipos (p. ej. una
  // erosión de la orilla por la crecida) solo cuenta si el agua salió del cauce.
  if (riverOverflow || (isFlood && HAS_WATER_BODY.test(text) && RISE.test(text))) return 'river_flood';
  if (COASTAL.test(text)) return 'coastal_flood';
  // Lluvias intensas sin agua acumulada son muros caídos, árboles sobre casas…
  if (!isFlood && !STANDING_WATER.test(text)) return null;
  return DRAINAGE.test(text) ? 'drainage_flood' : 'rain_flood';
}

const WATER_BODY_NAME =
  /\b([Rr][ií]o|[Ee]stero|[Qq]uebrada)\s+(\p{Lu}[\p{L}'-]*(?!\/)(?:\s+(?:(?:de|del|la|las|los|el)\s+)?\p{Lu}[\p{L}'-]*)*)/u;

/**
 * "…desbordamiento del río La Clementina, dejando…" -> "Río La Clementina".
 * Null si no se nombra o es "S/N" (sin nombre).
 */
export function waterBodyFromDescription(description: string | null): string | null {
  const match = WATER_BODY_NAME.exec(description ?? '');
  if (!match) return null;
  const kind = plain(match[1]);
  return `${kind === 'rio' ? 'Río' : kind[0].toUpperCase() + kind.slice(1)} ${match[2]}`;
}

/** Cifras del registro que pesan en el impacto (diccionario de variables de la SNGR). */
type ImpactFigures = Pick<
  SngrEvent,
  | 'PersonasFallecidas'
  | 'PersonasExtraviadas'
  | 'PersonasDamnificadas'
  | 'PersonasEvacuadas'
  | 'ViviendasDestruidas'
  | 'PuentesDestruidos'
  | 'ViviendasAfectadas'
  | 'FamiliasAfectadas'
  | 'PersonasAfectadasDirectamente'
  | 'HaCultivoAfectados'
  | 'HaCultivoPerdidos'
  | 'PuentesAfectados'
  | 'EstablecimientosEducativosAfectados'
  | 'CentrosDeSaludAfectados'
>;

/**
 * Alto: hubo víctimas, damnificados, evacuados o destrucción.
 * Medio: hubo daños parciales en viviendas, familias, cultivos o servicios.
 * Bajo: solo calles o vías con agua.
 * Casi todos los eventos llegan como "Nivel 1", así que el nivel oficial no los separa.
 */
export function impactLevelFromSngrEvent(record: ImpactFigures): ImpactLevel {
  const any = (...values: number[]) => values.some((value) => value > 0);
  if (
    any(
      record.PersonasFallecidas,
      record.PersonasExtraviadas,
      record.PersonasDamnificadas,
      record.PersonasEvacuadas,
      record.ViviendasDestruidas,
      record.PuentesDestruidos,
    )
  ) {
    return 'high';
  }
  if (
    any(
      record.ViviendasAfectadas,
      record.FamiliasAfectadas,
      record.PersonasAfectadasDirectamente,
      record.HaCultivoAfectados,
      record.HaCultivoPerdidos,
      record.PuentesAfectados,
      record.EstablecimientosEducativosAfectados,
      record.CentrosDeSaludAfectados,
    )
  ) {
    return 'medium';
  }
  return 'low';
}
