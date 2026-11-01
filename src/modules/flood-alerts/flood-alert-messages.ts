import { escapeHtml } from '../../common/text/escape-html.js';
import type { CantonForecast } from './flash-flood-cantons.js';
import type { IssueChanges } from './flash-flood-transitions.js';

const SOURCE_NOTE = 'Prueba de SATI. Pronóstico de Google, no confirmado por la SNGR.';

const untilFormat = new Intl.DateTimeFormat('es-EC', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Guayaquil',
});

const byName = (a: string, b: string) => a.localeCompare(b, 'es');

/** Una línea por provincia, primero las de más cantones, con todos sus cantones. */
function provinceLines(cantons: readonly CantonForecast[]): string[] {
  const provinces = new Map<string, string[]>();
  for (const { province, canton } of cantons) provinces.set(province, [...(provinces.get(province) ?? []), canton]);
  return [...provinces.entries()]
    .sort(([nameA, a], [nameB, b]) => b.length - a.length || byName(nameA, nameB))
    .map(([province, names]) => `<b>${escapeHtml(province)} (${names.length}):</b> ${names.sort(byName).map(escapeHtml).join(', ')}`);
}

function levelSection(title: string, cantons: readonly CantonForecast[]): string[] {
  if (cantons.length === 0) return [];
  const count = cantons.length === 1 ? '1 cantón' : `${cantons.length} cantones`;
  return [`${title} · ${count}`, ...provinceLines(cantons), ''];
}

const levelSections = (cantons: readonly CantonForecast[]) => [
  ...levelSection(
    '🔴 <b>Muy probable</b>',
    cantons.filter((canton) => canton.likelihood === 'highly_likely'),
  ),
  ...levelSection(
    '🟠 <b>Probable</b>',
    cantons.filter((canton) => canton.likelihood === 'likely'),
  ),
];

/** Cantones que entraron o subieron de nivel. */
export function worsenedMessage(cantons: readonly CantonForecast[], validUntil: Date): string {
  return [
    '⚠️ <b>SATI · Riesgo de crecida repentina</b>',
    `Vigente hasta ${untilFormat.format(validUntil)}`,
    '',
    ...levelSections(cantons),
    SOURCE_NOTE,
  ].join('\n');
}

/** Cantones que bajaron o salieron. Nunca dice que no hay peligro: solo cambió el pronóstico. */
export function improvedMessage({ lowered, left }: Pick<IssueChanges, 'lowered' | 'left'>): string {
  const section = (title: string, cantons: readonly CantonForecast[]) =>
    cantons.length > 0 ? [`<b>${title}</b>`, ...provinceLines(cantons), ''] : [];
  return [
    '🔕 <b>SATI · Actualización</b>',
    '',
    ...section('Bajó a Probable', lowered),
    ...section('Ya no aparecen en el pronóstico', left),
    'Si llovió fuerte, el riesgo en el terreno puede continuar. Sigue las indicaciones de la SNGR y del COE.',
    '',
    SOURCE_NOTE,
  ].join('\n');
}

/** Lo vigente ahora: para quien recién entra y para /estado. */
export function statusMessage(cantons: readonly CantonForecast[], validUntil: Date | null): string {
  if (cantons.length === 0 || !validUntil) return `Por ahora Google no marca zonas de crecida repentina en el Ecuador.\n\n${SOURCE_NOTE}`;
  return worsenedMessage(cantons, validUntil);
}
