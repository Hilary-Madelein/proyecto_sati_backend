import { escapeHtml } from '../../common/text/escape-html.js';
import type { CantonRain } from './canton-rain.js';
import type { CantonForecast } from './flash-flood-cantons.js';
import { NATIONAL, isNational, singlePlace, type ChatScope } from './flood-alert-scope.js';
import type { IssueChanges } from './flash-flood-transitions.js';

/*
 * La alerta es un resumen que se lee en segundos: qué pasa y hasta cuándo,
 * cuántos lugares por nivel y los de más lluvia. El detalle de cada cantón y sus
 * parroquias se abre con el botón "Más detalle" (ver flood-alert-explorer.ts).
 * Cada bloque separado por una línea en blanco debe ser HTML completo: un mensaje
 * largo se parte por ahí (ver `splitText`).
 */

const SOURCE_NOTE = '<i>Prueba de SATI. Pronóstico de Google, no confirmado por la SNGR.</i>';
const PRECISION_NOTE = '<i>Referencia por zonas de unos 20 km.</i>';
const FORECAST_NOTE = '<i>mm: lluvia pronosticada para 24 h, lo más alto del cantón (WRF-INAMHI).</i>';
const DETAIL_HINT = '<i>🔎 Toca «Más detalle» para ver cada cantón y sus parroquias.</i>';
const SINGLE_DETAIL_HINT = '<i>🔎 Toca «Más detalle» para ver sus parroquias.</i>';
/** Cantones con más lluvia que se nombran por nivel; con estos o menos, se nombran todos. */
const TOP_CANTONS = 3;

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

/** Sin decimales: a esta escala serían falsa precisión. En HTML, "<" va escapado; en un botón, no. */
export const formatMm = (value: number, html = true) => `${value > 0 && value < 1 ? (html ? '&lt;1' : '<1') : Math.round(value)} mm`;

/** Se eligió un solo cantón: su nivel lo dice todo. */
const isSingleCanton = (scope: ChatScope) => scope.cantons.length === 1 && scope.provinces.length === 0 && scope.zones.length === 0;
/** Se eligió una sola provincia: no hace falta repetir su nombre. */
const isSingleProvince = (scope: ChatScope) => scope.provinces.length === 1 && scope.cantons.length === 0 && scope.zones.length === 0;

/** Primero los de más lluvia pronosticada: es lo que más interesa, y sin cifras, por nombre. */
const byRain = (a: AlertCanton, b: AlertCanton) => (b.rain?.forecastMm ?? -1) - (a.rain?.forecastMm ?? -1) || byName(a.canton, b.canton);

/** Cantones por provincia, primero las de más cantones. */
function byProvince<T extends CantonForecast>(cantons: readonly T[]): [string, T[]][] {
  const provinces = new Map<string, T[]>();
  for (const canton of cantons) provinces.set(canton.province, [...(provinces.get(canton.province) ?? []), canton]);
  return [...provinces.entries()].sort(([nameA, a], [nameB, b]) => b.length - a.length || byName(nameA, nameB));
}

const summaryEntry = ({ canton, rain }: AlertCanton) =>
  `${escapeHtml(canton)}${rain && rain.forecastMm !== null ? ` ${formatMm(rain.forecastMm)}` : ''}`;

/** Un nivel en tres líneas: cuántos, en qué provincias y los de más lluvia. */
function levelSummary(title: string, cantons: readonly AlertCanton[], scope: ChatScope): string[] {
  if (cantons.length === 0) return [];
  const sorted = [...cantons].sort(byRain);
  const hasRain = cantons.some(({ rain }) => rain && rain.forecastMm !== null);
  const names =
    sorted.length <= TOP_CANTONS
      ? sorted.map(summaryEntry).join(', ')
      : `${hasRain ? 'Más lluvia' : 'Entre ellos'}: ${sorted.slice(0, TOP_CANTONS).map(summaryEntry).join(', ')} y ${sorted.length - TOP_CANTONS} más`;
  return [
    [
      `${title} · ${plural(cantons.length)}`,
      ...(isSingleProvince(scope) ? [] : [byProvince(cantons).map(([province, list]) => `${escapeHtml(province)} ${list.length}`).join(' · ')]),
      names,
    ].join('\n'),
  ];
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
    ...(rain && rain.forecastMm !== null ? [`Pronóstico 24 h: hasta ${formatMm(rain.forecastMm)} (WRF-INAMHI)`] : []),
    ...(rain?.measured
      ? [`🌧️ Ya medido en 12 h: ${formatMm(rain.measured.mm)} (${escapeHtml(rain.measured.station)}, a ${Math.round(rain.measured.km)} km)`]
      : []),
  ];
  return [level, ...(details.length > 0 ? [details.join('\n')] : [])];
}

/** Resumen de cuántos lugares hay. Con uno solo, el título ya lo dice. */
function summaryLine(cantons: readonly AlertCanton[], scope: ChatScope): string[] {
  if (isSingleCanton(scope) || isSingleProvince(scope)) return [];
  const provinces = byProvince(cantons).length;
  return [`📍 ${plural(cantons.length)} en ${provinces === 1 ? '1 provincia' : `${provinces} provincias`}`];
}

/** Cantones que entraron o subieron de nivel, dentro de lo que eligió la persona. */
export function worsenedMessage(cantons: readonly AlertCanton[], validUntil: Date, scope: ChatScope = NATIONAL): string {
  const header = [
    `⚠️ <b>SATI · Riesgo de crecida repentina${placeSuffix(scope)}</b>`,
    `🕒 Vigente hasta ${untilFormat.format(validUntil)}`,
    ...summaryLine(cantons, scope),
  ].join('\n');

  const onlyCantons = scope.cantons.length > 0 && scope.provinces.length === 0 && scope.zones.length === 0;
  if (isSingleCanton(scope) && cantons[0]) {
    const notes = [...(onlyCantons ? [PRECISION_NOTE] : []), SOURCE_NOTE, SINGLE_DETAIL_HINT].join('\n');
    return [header, ...singleCantonBlocks(cantons[0]), notes].join('\n\n');
  }

  const hasForecast = cantons.some(({ rain }) => rain && rain.forecastMm !== null);
  const notes = [...(hasForecast ? [FORECAST_NOTE] : []), ...(onlyCantons ? [PRECISION_NOTE] : []), SOURCE_NOTE, DETAIL_HINT].join('\n');
  return [
    header,
    ...levelSummary(
      '🔴 <b>MUY PROBABLE</b>',
      cantons.filter((canton) => canton.likelihood === 'highly_likely'),
      scope,
    ),
    ...levelSummary(
      '🟠 <b>PROBABLE</b>',
      cantons.filter((canton) => canton.likelihood === 'likely'),
      scope,
    ),
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
