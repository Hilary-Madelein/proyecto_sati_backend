import { isInsideRings, type Ring } from '../../common/geo/polygon.js';
import { escapeHtml } from '../../common/text/escape-html.js';
import type { TelegramButton } from '../../integrations/telegram/telegram.client.js';
import type { ParishAlert } from '../canton-analysis/canton-analysis.service.js';
import type { ParishPoint } from '../canton-analysis/parishes.js';
import type { FlashFloodArea } from '../flood-hub/flood-hub-source.js';
import type { CatalogProvince } from './canton-catalog.js';
import { formatMm, type AlertCanton } from './flood-alert-messages.js';
import { zoneOfCanton } from './planning-zones.js';

/*
 * "Más detalle": se baja de zona a provincia, a cantón y a sus parroquias con
 * botones que reemplazan el mensaje en el mismo lugar. Un nivel con una sola
 * opción se salta, y su botón "Volver" lleva al último nivel con varias.
 */

/** Botón de la alerta: abre el detalle en un mensaje aparte, para no perder la alerta. */
export const EXPLORE = 'x';
const ROOT = 'xr';
const ZONE = 'xz:';
const PROVINCE = 'xp:';
const CANTON = 'xc:';

export type ExplorerTarget =
  | { kind: 'root' }
  | { kind: 'zone'; zone: number }
  | { kind: 'province'; province: string; zone: number }
  | { kind: 'canton'; code: string; zone: number };

export interface ExplorerData {
  /** Cantones con riesgo vigente dentro de lo que eligió la persona, con su lluvia si se pudo leer. */
  cantons: AlertCanton[];
  validUntil: Date | null;
  /** Zonas de Google de la emisión vigente. */
  zones: FlashFloodArea[];
  /** Todas las parroquias (nombre y punto). */
  parishes: ParishPoint[];
  /** Pronóstico en el punto de cada parroquia; vacío si no se pudo leer. */
  forecasts: Pick<ParishAlert, 'code' | 'forecast'>[];
  /** Provincias del catálogo: los botones usan su posición. */
  provinces: CatalogProvince[];
}

export interface ExplorerView {
  text: string;
  buttons: TelegramButton[][];
}

const LEVEL_LEGEND = '<i>🔴 hay cantones en Muy probable · 🟠 solo Probable</i>';
const byName = (a: string, b: string) => a.localeCompare(b, 'es');
const plural = (count: number) => (count === 1 ? '1 cantón' : `${count} cantones`);
const zoneOf = (canton: AlertCanton) => zoneOfCanton(canton.code) ?? 0;
const levelMark = (cantons: readonly AlertCanton[]) => (cantons.some(({ likelihood }) => likelihood === 'highly_likely') ? '🔴' : '🟠');
const levelRank = ({ likelihood }: AlertCanton) => (likelihood === 'highly_likely' ? 1 : 0);
/** Primero los Muy probables, aunque no llueva, y dentro de cada nivel, los de más lluvia. */
const byLevelAndRain = (a: AlertCanton, b: AlertCanton) =>
  levelRank(b) - levelRank(a) || (b.rain?.forecastMm ?? -1) - (a.rain?.forecastMm ?? -1) || byName(a.canton, b.canton);

export const isExplorerData = (data: string) =>
  data === EXPLORE || data === ROOT || [ZONE, PROVINCE, CANTON].some((prefix) => data.startsWith(prefix));

export function parseTarget(data: string, provinces: readonly CatalogProvince[]): ExplorerTarget | null {
  if (data === EXPLORE || data === ROOT) return { kind: 'root' };
  if (data.startsWith(ZONE)) {
    const zone = Number(data.slice(ZONE.length));
    return Number.isInteger(zone) ? { kind: 'zone', zone } : null;
  }
  if (data.startsWith(PROVINCE)) {
    const [index, zone] = data.slice(PROVINCE.length).split(':');
    const province = provinces[Number(index)]?.name;
    return province ? { kind: 'province', province, zone: Number(zone) } : null;
  }
  if (data.startsWith(CANTON)) {
    const [code, zone] = data.slice(CANTON.length).split(':');
    return code ? { kind: 'canton', code, zone: Number(zone) } : null;
  }
  return null;
}

const inZone = (data: ExplorerData, zone: number) => data.cantons.filter((canton) => zoneOf(canton) === zone);
const inProvince = (data: ExplorerData, province: string, zone: number) =>
  inZone(data, zone).filter((canton) => canton.province === province);
const zonesOf = (data: ExplorerData) => [...new Set(data.cantons.map(zoneOf))].sort((a, b) => a - b);
const provincesOf = (data: ExplorerData, zone: number) => {
  const counts = new Map<string, number>();
  for (const { province } of inZone(data, zone)) counts.set(province, (counts.get(province) ?? 0) + 1);
  return [...counts.entries()].sort(([nameA, a], [nameB, b]) => b - a || byName(nameA, nameB)).map(([name]) => name);
};

const zoneData = (zone: number) => `${ZONE}${zone}`;
const provinceData = (data: ExplorerData, province: string, zone: number) =>
  `${PROVINCE}${data.provinces.findIndex(({ name }) => name === province)}:${zone}`;
const cantonData = (code: string, zone: number) => `${CANTON}${code}:${zone}`;

function twoColumns(buttons: TelegramButton[]): TelegramButton[][] {
  const rows: TelegramButton[][] = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  return rows;
}

/** Vuelve al último nivel con más de una opción (los de una sola se saltan al bajar). */
function backButtons(data: ExplorerData, from: 'zone' | 'province' | 'canton', province: string, zone: number): TelegramButton[][] {
  if (from === 'canton' && inProvince(data, province, zone).length > 1) return [[{ label: `← ${province}`, data: provinceData(data, province, zone) }]];
  if (from !== 'zone' && provincesOf(data, zone).length > 1) return [[{ label: `← Zona ${zone}`, data: zoneData(zone) }]];
  if (zonesOf(data).length > 1) return [[{ label: '← Zonas', data: ROOT }]];
  return [];
}

export function explorerView(data: ExplorerData, target: ExplorerTarget): ExplorerView {
  if (data.cantons.length === 0) return { text: '🔎 Por ahora no hay riesgo de crecida repentina vigente en lo que elegiste.', buttons: [] };
  switch (target.kind) {
    case 'root':
      return rootView(data);
    case 'zone':
      return zoneView(data, target.zone);
    case 'province':
      return provinceView(data, target.province, target.zone);
    case 'canton':
      return cantonView(data, target.code, target.zone);
  }
}

function rootView(data: ExplorerData): ExplorerView {
  const zones = zonesOf(data);
  if (zones.length === 1) return zoneView(data, zones[0]);
  const buttons = zones.map((zone) => {
    const cantons = inZone(data, zone);
    return { label: `${levelMark(cantons)} Zona ${zone} · ${cantons.length}`, data: zoneData(zone) };
  });
  return {
    text: [`🔎 <b>Riesgo vigente por zona</b> · ${plural(data.cantons.length)}`, 'Elige una zona para ver sus provincias:', '', LEVEL_LEGEND].join('\n'),
    buttons: twoColumns(buttons),
  };
}

function zoneView(data: ExplorerData, zone: number): ExplorerView {
  const cantons = inZone(data, zone);
  if (cantons.length === 0) return rootView(data);
  const provinces = provincesOf(data, zone);
  if (provinces.length === 1) return provinceView(data, provinces[0], zone);
  const buttons = provinces.map((province) => {
    const list = inProvince(data, province, zone);
    return { label: `${levelMark(list)} ${province} · ${list.length}`, data: provinceData(data, province, zone) };
  });
  return {
    text: [`🔎 <b>Zona ${zone}</b> · ${plural(cantons.length)}`, 'Elige una provincia para ver sus cantones:', '', LEVEL_LEGEND].join('\n'),
    buttons: [...twoColumns(buttons), ...backButtons(data, 'zone', '', zone)],
  };
}

function provinceView(data: ExplorerData, province: string, zone: number): ExplorerView {
  const cantons = inProvince(data, province, zone);
  if (cantons.length === 0) return rootView(data);
  if (cantons.length === 1) return cantonView(data, cantons[0].code, zone);
  const buttons = [...cantons].sort(byLevelAndRain).map((canton) => {
    const mm = canton.rain?.forecastMm;
    const rain = mm === null || mm === undefined ? '' : ` · ${formatMm(mm, false)}`;
    return [{ label: `${levelMark([canton])} ${canton.canton}${rain}`, data: cantonData(canton.code, zone) }];
  });
  return {
    text: [
      `🔎 <b>${escapeHtml(province)}</b> · Zona ${zone} · ${plural(cantons.length)}`,
      'Elige un cantón para ver sus parroquias:',
      '',
      '<i>🔴 Muy probable · 🟠 Probable · mm: lluvia pronosticada para 24 h</i>',
    ].join('\n'),
    buttons: [...buttons, ...backButtons(data, 'province', province, zone)],
  };
}

const untilFormat = new Intl.DateTimeFormat('es-EC', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Guayaquil',
});

/** Las parroquias del cantón: dentro de la zona de Google primero, y de más a menos lluvia. */
function cantonView(data: ExplorerData, code: string, zone: number): ExplorerView {
  const canton = data.cantons.find((item) => item.code === code);
  if (!canton) return rootView(data);

  const polygons = data.zones.flatMap((area) => area.geometry.coordinates as unknown as Ring[][]);
  const forecasts = new Map(data.forecasts.map(({ code: parish, forecast }) => [parish, forecast.mm24h]));
  const parishes = data.parishes
    .filter((parish) => parish.cantonCode === code)
    .map((parish) => ({
      name: parish.name,
      inside: polygons.some((rings) => isInsideRings(rings, parish.lng, parish.lat)),
      mm: forecasts.get(parish.code) ?? null,
    }))
    .sort((a, b) => Number(b.inside) - Number(a.inside) || (b.mm ?? -1) - (a.mm ?? -1) || byName(a.name, b.name));

  const level = canton.likelihood === 'highly_likely' ? '🔴 Muy probable' : '🟠 Probable';
  const hasForecast = parishes.some(({ mm }) => mm !== null);
  const measured = canton.rain?.measured;
  return {
    text: [
      `🔎 <b>${escapeHtml(canton.canton)}</b> · ${escapeHtml(canton.province)}`,
      `${level}${data.validUntil ? ` · vigente hasta ${untilFormat.format(data.validUntil)}` : ''}`,
      '',
      hasForecast ? '<b>Parroquias</b> · lluvia pronosticada para 24 h (WRF-INAMHI)' : '<b>Parroquias</b>',
      ...parishes.map(({ name, inside, mm }) => `${inside ? '⚠️' : '▫️'} ${escapeHtml(name)}${hasForecast ? ` · ${mm === null ? 'sin dato' : formatMm(mm)}` : ''}`),
      ...(measured ? ['', `🌧️ Ya medido en 12 h: ${formatMm(measured.mm)} (${escapeHtml(measured.station)}, a ${Math.round(measured.km)} km)`] : []),
      '',
      '<i>⚠️ dentro de la zona de riesgo de Google · ▫️ fuera de ella. Referencia por zonas de unos 20 km.</i>',
    ].join('\n'),
    buttons: backButtons(data, 'canton', canton.province, zone),
  };
}
