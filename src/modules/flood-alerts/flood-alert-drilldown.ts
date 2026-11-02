import type { TelegramButton } from '../../integrations/telegram/telegram.client.js';
import type { CantonForecast } from './flash-flood-cantons.js';
import { isOnlyCantons, isOnlyProvinces, isSingleCanton, type ChatScope } from './flood-alert-scope.js';
import { zoneOfCanton } from './planning-zones.js';

/*
 * Desglose de una alerta con botones, para no saturar el chat: zona (o provincia,
 * si eso eligió la persona) → cantón → parroquia. Cada botón edita el mismo mensaje
 * y baja por un solo lugar: así el texto siempre cabe en un mensaje, que al editarse
 * ya no se puede partir. Muestra lo vigente al tocarlo, no lo que había al enviarse.
 */

/** Prefijo de los datos de sus botones (máximo 64 bytes): `dr:` = el resumen; `dr:z5`, `dr:p09` y `dr:c0901` = un lugar. */
export const DRILL = 'dr:';
const SUMMARY = DRILL;
const CANTON_TARGET = 'c';

export interface AlertGroup<T> {
  key: string;
  title: string;
  cantons: T[];
}

export const isCantonTarget = (target: string) => target.startsWith(CANTON_TARGET);
export const cantonCodeOf = (target: string) => target.slice(CANTON_TARGET.length);

function groupOf({ code, province }: Pick<CantonForecast, 'code' | 'province'>, scope: ChatScope): Pick<AlertGroup<never>, 'key' | 'title'> {
  if (isOnlyProvinces(scope)) return { key: `p${code.slice(0, 2)}`, title: province };
  const zone = zoneOfCanton(code);
  return { key: `z${zone ?? 0}`, title: zone ? `Zona ${zone}` : 'Sin zona' };
}

/** Los cantones por zona de planificación o, si la persona solo eligió provincias, por provincia. */
export function groupsOf<T extends CantonForecast>(cantons: readonly T[], scope: ChatScope): AlertGroup<T>[] {
  const groups = new Map<string, AlertGroup<T>>();
  for (const canton of cantons) {
    const { key, title } = groupOf(canton, scope);
    const group = groups.get(key) ?? { key, title, cantons: [] };
    group.cantons.push(canton);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

/** Botones en dos columnas. */
export function twoColumns(buttons: TelegramButton[]): TelegramButton[][] {
  const rows: TelegramButton[][] = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  return rows;
}

const cantonButtons = (cantons: readonly CantonForecast[]) =>
  twoColumns(
    [...cantons]
      .sort((a, b) => a.canton.localeCompare(b.canton, 'es'))
      .map(({ code, canton }) => ({ label: canton, data: `${DRILL}${CANTON_TARGET}${code}` })),
  );

/** Botones del mensaje con el que se empieza: el de la alerta y el de /estado. */
export function summaryButtons(cantons: readonly CantonForecast[], scope: ChatScope): TelegramButton[][] {
  if (cantons.length === 0) return [];
  if (isSingleCanton(scope)) return [[{ label: 'Desglosar por parroquia', data: `${DRILL}${CANTON_TARGET}${cantons[0].code}` }]];
  if (isOnlyCantons(scope)) return cantonButtons(cantons);
  return twoColumns(groupsOf(cantons, scope).map(({ key, title }) => ({ label: `Desglosar ${title}`, data: `${DRILL}${key}` })));
}

/** Botones de una zona o provincia: sus cantones y volver al resumen. */
export function groupButtons(group: AlertGroup<CantonForecast>, scope: ChatScope): TelegramButton[][] {
  return [...cantonButtons(group.cantons), [{ label: isOnlyProvinces(scope) ? '← Provincias' : '← Zonas', data: SUMMARY }]];
}

/** Botón de un cantón ya desglosado: volver a donde se llegó. */
export function parishButtons(canton: CantonForecast, scope: ChatScope): TelegramButton[][] {
  if (isOnlyCantons(scope)) return [[{ label: isSingleCanton(scope) ? '← Volver' : '← Cantones', data: SUMMARY }]];
  const { key, title } = groupOf(canton, scope);
  return [[{ label: `← ${title}`, data: `${DRILL}${key}` }]];
}
