import { escapeHtml } from '../../common/text/escape-html.js';
import type { CantonRain } from './canton-rain.js';
import type { CantonForecast } from './flash-flood-cantons.js';
import { NATIONAL, isNational, singlePlace, type ChatScope } from './flood-alert-scope.js';
import type { IssueChanges } from './flash-flood-transitions.js';

/*
 * Los mensajes van de lo general al detalle: qué pasa y hasta cuándo, cuántos
 * lugares, y luego un cantón por línea, primero los de más lluvia. Cada bloque
 * separado por una línea en blanco debe ser HTML completo: un mensaje largo se
 * parte por ahí (ver `splitText`).
 */

const SOURCE_NOTE = '<i>Prueba de SATI. Pronóstico de Google, no confirmado por la SNGR.</i>';
const PRECISION_NOTE = '<i>Referencia por zonas de unos 20 km.</i>';
const FORECAST_NOTE = '<i>mm: lluvia pronosticada para 24 h, lo más alto del cantón (WRF-INAMHI).</i>';
const MEASURED_NOTE = '<i>🌧️: lluvia ya medida en 12 h, en una estación a menos de 10 km.</i>';
/** Con más cantones que esto, los Probables van plegados: los Muy probables siempre se ven. */
const MAX_OPEN_CANTONS = 8;

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

/** Se eligió un solo cantón: su nivel lo dice todo. */
const isSingleCanton = (scope: ChatScope) => scope.cantons.length === 1 && scope.provinces.length === 0;
/** Se eligió una sola provincia: no hace falta repetir su nombre. */
const isSingleProvince = (scope: ChatScope) => scope.provinces.length === 1 && scope.cantons.length === 0;

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

/** Un bloque por provincia; con una sola provincia elegida, un solo bloque sin su nombre. */
function placeBlocks(cantons: readonly AlertCanton[], scope: ChatScope, folded: boolean): string[] {
  if (isSingleProvince(scope)) return [quote(cantonLines(cantons), folded)];
  return byProvince(cantons).map(([province, list]) => quote([`<b>${escapeHtml(province)} · ${list.length}</b>`, ...cantonLines(list)], folded));
}

function levelBlocks(title: string, cantons: readonly AlertCanton[], scope: ChatScope, folded: boolean): string[] {
  if (cantons.length === 0) return [];
  return [`${title} · ${plural(cantons.length)}`, ...placeBlocks(cantons, scope, folded)];
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
  const provinces = byProvince(cantons).length;
  return [`📍 ${plural(cantons.length)} en ${provinces === 1 ? '1 provincia' : `${provinces} provincias`}`];
}

function rainNotes(cantons: readonly AlertCanton[]): string[] {
  const hasForecast = cantons.some(({ rain }) => rain && rain.forecastMm !== null);
  const hasMeasured = cantons.some(({ rain }) => rain?.measured);
  return [...(hasForecast ? [FORECAST_NOTE] : []), ...(hasMeasured ? [MEASURED_NOTE] : [])];
}

/** Cantones que entraron o subieron de nivel, dentro de lo que eligió la persona. */
export function worsenedMessage(cantons: readonly AlertCanton[], validUntil: Date, scope: ChatScope = NATIONAL): string {
  const header = [
    `⚠️ <b>SATI · Riesgo de crecida repentina${placeSuffix(scope)}</b>`,
    `🕒 Vigente hasta ${untilFormat.format(validUntil)}`,
    ...summaryLine(cantons, scope),
  ].join('\n');

  const onlyCantons = scope.cantons.length > 0 && scope.provinces.length === 0;
  const notes = [...(isSingleCanton(scope) ? [] : rainNotes(cantons)), ...(onlyCantons ? [PRECISION_NOTE] : []), SOURCE_NOTE].join('\n');
  if (isSingleCanton(scope) && cantons[0]) return [header, ...singleCantonBlocks(cantons[0]), notes].join('\n\n');

  const highlyLikely = cantons.filter((canton) => canton.likelihood === 'highly_likely');
  const likely = cantons.filter((canton) => canton.likelihood === 'likely');
  return [
    header,
    ...levelBlocks('🔴 <b>MUY PROBABLE</b>', highlyLikely, scope, false),
    ...levelBlocks('🟠 <b>PROBABLE</b>', likely, scope, likely.length > MAX_OPEN_CANTONS),
    notes,
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
