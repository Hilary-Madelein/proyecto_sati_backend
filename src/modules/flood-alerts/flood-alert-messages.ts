import { escapeHtml } from '../../common/text/escape-html.js';
import type { CantonRain } from './canton-rain.js';
import type { CantonForecast, ParishForecast } from './flash-flood-cantons.js';
import { groupsOf } from './flood-alert-drilldown.js';
import { NATIONAL, isNational, isOnlyCantons, isOnlyProvinces, isSingleCanton, singlePlace, type ChatScope } from './flood-alert-scope.js';
import type { IssueChanges } from './flash-flood-transitions.js';

/*
 * Los mensajes van de lo general al detalle: la alerta dice qué pasa, hasta cuándo
 * y cuánto en cada zona, y con botones se baja a cantón y a parroquia (ver
 * flood-alert-drilldown.ts). Cada bloque separado por una línea en blanco debe ser
 * HTML completo: un mensaje largo se parte por ahí (ver `splitText`).
 */

const SOURCE_NOTE = '<i>Prueba de SATI. Pronóstico de Google, no confirmado por la SNGR.</i>';
const PRECISION_NOTE = '<i>Referencia por zonas de unos 20 km.</i>';
const FORECAST_NOTE = '<i>mm: lluvia pronosticada para 24 h, lo más alto de cada lugar (WRF-INAMHI).</i>';
const PARISH_FORECAST_NOTE = '<i>mm: lluvia pronosticada para 24 h en cada parroquia (WRF-INAMHI).</i>';
const MEASURED_NOTE = '<i>🌧️: lluvia ya medida en 12 h, en una estación a menos de 10 km.</i>';
/** Con más cantones que esto, los Probables van plegados: los Muy probables siempre se ven. */
const MAX_OPEN_CANTONS = 8;
const CANTON_HINT = '👇 Toca un cantón para desglosarlo por parroquia.';

const untilFormat = new Intl.DateTimeFormat('es-EC', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Guayaquil',
});

/** Cantón de un mensaje, con su lluvia si se pudo leer. */
export type AlertCanton = CantonForecast & { rain?: CantonRain };

const byName = (a: string, b: string) => a.localeCompare(b, 'es');
const plural = (count: number) => (count === 1 ? '1 cantón' : `${count} cantones`);

/** Se eligió una sola provincia: no hace falta repetir su nombre. */
const isSingleProvince = (scope: ChatScope) => scope.provinces.length === 1 && scope.cantons.length === 0 && scope.zones.length === 0;

/** Sin decimales: a esta escala serían falsa precisión. */
const mm = (value: number) => `${value > 0 && value < 1 ? '&lt;1' : Math.round(value)} mm`;

/** Primero los de más lluvia pronosticada: es lo que más interesa, y sin cifras, por nombre. */
const byRain = (a: AlertCanton, b: AlertCanton) => (b.rain?.forecastMm ?? -1) - (a.rain?.forecastMm ?? -1) || byName(a.canton, b.canton);

function cantonLine({ canton, rain }: AlertCanton): string {
  return [
    escapeHtml(canton),
    ...(rain?.forecastMm === null || rain?.forecastMm === undefined ? [] : [mm(rain.forecastMm)]),
    ...(rain?.measured ? [`🌧️ ${mm(rain.measured.mm)}`] : []),
  ].join(' · ');
}

const cantonLines = (cantons: readonly AlertCanton[]) => [...cantons].sort(byRain).map(cantonLine);

/** Cantones por provincia, primero las de más cantones. */
function byProvince(cantons: readonly AlertCanton[]): [string, AlertCanton[]][] {
  const provinces = new Map<string, AlertCanton[]>();
  for (const canton of cantons) provinces.set(canton.province, [...(provinces.get(canton.province) ?? []), canton]);
  return [...provinces.entries()].sort(([nameA, a], [nameB, b]) => b.length - a.length || byName(nameA, nameB));
}

const quote = (lines: string[], folded: boolean) => `<blockquote${folded ? ' expandable' : ''}>${lines.join('\n')}</blockquote>`;

/** Un bloque por provincia; si son de una sola, un solo bloque sin su nombre. */
function placeBlocks(cantons: readonly AlertCanton[], folded: boolean): string[] {
  const provinces = byProvince(cantons);
  if (provinces.length === 1) return [quote(cantonLines(cantons), folded)];
  return provinces.map(([province, list]) => quote([`<b>${escapeHtml(province)} · ${list.length}</b>`, ...cantonLines(list)], folded));
}

function levelBlocks(title: string, cantons: readonly AlertCanton[]): string[] {
  if (cantons.length === 0) return [];
  return [`${title} · ${plural(cantons.length)}`, ...placeBlocks(cantons, title === PROBABLE && cantons.length > MAX_OPEN_CANTONS)];
}

const HIGHLY_LIKELY = '🔴 <b>MUY PROBABLE</b>';
const PROBABLE = '🟠 <b>PROBABLE</b>';

/** Los bloques de cada nivel, de más a menos grave. */
const byLevel = (cantons: readonly AlertCanton[], blocks: (title: string, list: readonly AlertCanton[]) => string[]) => [
  ...blocks(HIGHLY_LIKELY, cantons.filter((canton) => canton.likelihood === 'highly_likely')),
  ...blocks(PROBABLE, cantons.filter((canton) => canton.likelihood === 'likely')),
];

/** "<b>Zona 5</b> (Guayas, Los Ríos) · 8 cantones · hasta 95 mm": una línea por zona o provincia. */
function summaryBlocks(title: string, cantons: readonly AlertCanton[], scope: ChatScope): string[] {
  if (cantons.length === 0) return [];
  const lines = groupsOf(cantons, scope).map((group) => {
    const provinces = byProvince(group.cantons).map(([province]) => escapeHtml(province));
    const forecasts = group.cantons.map(({ rain }) => rain?.forecastMm).filter((value) => value !== null && value !== undefined);
    return [
      `<b>${escapeHtml(group.title)}</b>${isOnlyProvinces(scope) ? '' : ` (${provinces.join(', ')})`}`,
      plural(group.cantons.length),
      ...(forecasts.length > 0 ? [`hasta ${mm(Math.max(...forecasts))}`] : []),
    ].join(' · ');
  });
  return [`${title} · ${plural(cantons.length)}`, quote(lines, false)];
}

const placeSuffix = (scope: ChatScope) => {
  const place = singlePlace(scope);
  return place ? ` en ${escapeHtml(place)}` : '';
};

/** Con un solo cantón hay espacio para decir de dónde sale cada cifra. */
function singleCantonBlocks(canton: AlertCanton): string[] {
  const { rain } = canton;
  const level = canton.likelihood === 'highly_likely' ? '🔴 <b>Muy probable</b>' : '🟠 <b>Probable</b>';
  const details = [
    ...(rain && rain.forecastMm !== null ? [`Pronóstico 24 h: hasta ${mm(rain.forecastMm)} (WRF-INAMHI)`] : []),
    ...(rain?.measured ? [`🌧️ Ya medido en 12 h: ${mm(rain.measured.mm)} (${escapeHtml(rain.measured.station)}, a ${Math.round(rain.measured.km)} km)`] : []),
  ];
  return [level, ...(details.length > 0 ? [details.join('\n')] : [])];
}

/** Resumen de cuántos lugares hay. Con uno solo, el título ya lo dice. */
function summaryLine(cantons: readonly AlertCanton[], scope: ChatScope): string[] {
  if (isSingleCanton(scope) || isSingleProvince(scope)) return [];
  const groups = isOnlyCantons(scope) ? byProvince(cantons).length : groupsOf(cantons, scope).length;
  const unit = isOnlyCantons(scope) || isOnlyProvinces(scope) ? ['provincia', 'provincias'] : ['zona', 'zonas'];
  return [`📍 ${plural(cantons.length)} en ${groups} ${unit[groups === 1 ? 0 : 1]}`];
}

function rainNotes(cantons: readonly AlertCanton[]): string[] {
  const hasForecast = cantons.some(({ rain }) => rain && rain.forecastMm !== null);
  const hasMeasured = cantons.some(({ rain }) => rain?.measured);
  return [...(hasForecast ? [FORECAST_NOTE] : []), ...(hasMeasured ? [MEASURED_NOTE] : [])];
}

/**
 * Cantones que entraron o subieron de nivel, dentro de lo que eligió la persona:
 * resumidos por zona o provincia, salvo si marcó cantones sueltos.
 */
export function worsenedMessage(cantons: readonly AlertCanton[], validUntil: Date, scope: ChatScope = NATIONAL): string {
  const header = [
    `⚠️ <b>SATI · Riesgo de crecida repentina${placeSuffix(scope)}</b>`,
    `🕒 Vigente hasta ${untilFormat.format(validUntil)}`,
    ...summaryLine(cantons, scope),
  ].join('\n');

  const onlyCantons = isOnlyCantons(scope);
  const hasRainInLines = onlyCantons ? rainNotes(cantons) : cantons.some(({ rain }) => rain && rain.forecastMm !== null) ? [FORECAST_NOTE] : [];
  const notes = [...(isSingleCanton(scope) ? [] : hasRainInLines), ...(onlyCantons ? [PRECISION_NOTE] : []), SOURCE_NOTE].join('\n');
  if (isSingleCanton(scope) && cantons[0]) return [header, ...singleCantonBlocks(cantons[0]), notes].join('\n\n');

  if (onlyCantons) return [header, ...byLevel(cantons, levelBlocks), CANTON_HINT, notes].join('\n\n');
  const hint = `👇 Toca ${isOnlyProvinces(scope) ? 'una provincia' : 'una zona'} para desglosarla por cantón.`;
  return [header, ...byLevel(cantons, (title, list) => summaryBlocks(title, list, scope)), hint, notes].join('\n\n');
}

const vigency = (title: string, validUntil: Date) => [`📍 <b>SATI · ${escapeHtml(title)}</b>`, `🕒 Vigente hasta ${untilFormat.format(validUntil)}`].join('\n');

/** Segundo nivel: los cantones vigentes de una zona o provincia. */
export function groupMessage(title: string, cantons: readonly AlertCanton[], validUntil: Date): string {
  return [vigency(title, validUntil), ...byLevel(cantons, levelBlocks), CANTON_HINT, [...rainNotes(cantons), SOURCE_NOTE].join('\n')].join('\n\n');
}

/** Parroquia de un mensaje, con la lluvia pronosticada en su punto si se pudo leer. */
export type AlertParish = ParishForecast & { forecastMm?: number | null };

const parishCount = (count: number) => (count === 1 ? '1 parroquia' : `${count} parroquias`);

function parishBlocks(title: string, parishes: readonly AlertParish[]): string[] {
  if (parishes.length === 0) return [];
  const lines = [...parishes]
    .sort((a, b) => (b.forecastMm ?? -1) - (a.forecastMm ?? -1) || byName(a.parish, b.parish))
    .map(({ parish, forecastMm }) => [escapeHtml(parish), ...(forecastMm === null || forecastMm === undefined ? [] : [mm(forecastMm)])].join(' · '));
  return [`${title} · ${parishCount(parishes.length)}`, quote(lines, false)];
}

/**
 * Último nivel: las parroquias de un cantón. Las zonas de Google miden unos 20 km,
 * así que siempre avisa de que es una referencia. Un cantón puede seguir con aviso
 * sin parroquias en la última emisión: una mejora se avisa solo si la siguiente la confirma.
 */
export function parishMessage(canton: CantonForecast, parishes: readonly AlertParish[], validUntil: Date): string {
  const highlyLikely = parishes.filter((parish) => parish.likelihood === 'highly_likely');
  const likely = parishes.filter((parish) => parish.likelihood === 'likely');
  const hasForecast = parishes.some(({ forecastMm }) => forecastMm !== null && forecastMm !== undefined);
  return [
    vigency(`${canton.canton} · ${canton.province}`, validUntil),
    ...(parishes.length === 0 ? ['En la última emisión de Google ninguna parroquia de este cantón está dentro de las zonas de riesgo.'] : []),
    ...parishBlocks(HIGHLY_LIKELY, highlyLikely),
    ...parishBlocks(PROBABLE, likely),
    [...(hasForecast ? [PARISH_FORECAST_NOTE] : []), PRECISION_NOTE, SOURCE_NOTE].join('\n'),
  ].join('\n\n');
}

/** Solo los nombres: al mejorar el pronóstico, las cifras ya no son lo importante. */
function placeNames(cantons: readonly CantonForecast[], scope: ChatScope): string {
  const names = (list: readonly CantonForecast[]) =>
    list
      .map(({ canton }) => escapeHtml(canton))
      .sort(byName)
      .join(', ');
  if (isSingleProvince(scope) || isSingleCanton(scope)) return names(cantons);
  return byProvince(cantons)
    .map(([province, list]) => `<b>${escapeHtml(province)}:</b> ${names(list)}`)
    .join('\n');
}

/** Cantones que bajaron o salieron. Nunca dice que no hay peligro: solo cambió el pronóstico. */
export function improvedMessage({ lowered, left }: Pick<IssueChanges, 'lowered' | 'left'>, scope: ChatScope = NATIONAL): string {
  const section = (title: string, cantons: readonly CantonForecast[]) =>
    cantons.length > 0 ? [`<b>${title}</b>\n${placeNames(cantons, scope)}`] : [];
  return [
    `🔕 <b>SATI · Actualización${placeSuffix(scope)}</b>`,
    ...section('🟠 Bajó a Probable', lowered),
    ...section(isSingleCanton(scope) ? '⚪ Ya no aparece en el pronóstico' : '⚪ Ya no aparecen en el pronóstico', left),
    'Si llovió fuerte, el riesgo en el terreno puede continuar. Sigue las indicaciones de la SNGR y del COE.',
    SOURCE_NOTE,
  ].join('\n\n');
}

/** Lo vigente ahora dentro de lo elegido: para quien recién elige y para /estado. */
export function statusMessage(cantons: readonly AlertCanton[], validUntil: Date | null, scope: ChatScope = NATIONAL): string {
  if (cantons.length === 0 || !validUntil) {
    const place = singlePlace(scope);
    const where = place ? escapeHtml(place) : isNational(scope) ? 'el Ecuador' : 'los lugares que elegiste';
    return `✅ Por ahora Google no marca riesgo de crecida repentina en ${where}.\n\n${SOURCE_NOTE}`;
  }
  return worsenedMessage(cantons, validUntil, scope);
}
