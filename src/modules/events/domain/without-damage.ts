import type { HazardEventEntity } from '../entities/hazard-event.entity.js';

/**
 * Reporte "sin afectaciones": moderado, que no es desborde de río, y sin daño
 * registrado en personas, viviendas, cultivos o servicios (p. ej. calles con
 * agua que luego drenó). Es la misma regla con la que el panel de eventos del
 * frontend los oculta por defecto (`isUnverifiedEvent`): si cambia, cambiar las dos.
 */
export function isWithoutDamage(event: Pick<HazardEventEntity, 'severity' | 'hazardType' | 'hasDamage'>): boolean {
  return event.severity === 'moderate' && event.hazardType !== 'river_flood' && !event.hasDamage;
}

/** La misma regla en SQL, sobre el alias `event` de una consulta de TypeORM. */
export const WITHOUT_DAMAGE_SQL = `event.severity = 'moderate' AND event.hazardType <> 'river_flood' AND NOT event.hasDamage`;

/** Grupo del panel de eventos al que pertenece un evento. */
export type PanelGroup = 'open' | 'withoutDamage' | 'closed';

export function panelGroupOf(event: Pick<HazardEventEntity, 'status' | 'severity' | 'hazardType' | 'hasDamage'>): PanelGroup {
  if (event.status === 'closed') return 'closed';
  return isWithoutDamage(event) ? 'withoutDamage' : 'open';
}

/** `panelGroupOf` en SQL, sobre el alias `event`. */
export const PANEL_GROUP_SQL = `CASE WHEN event.status = 'closed' THEN 'closed' WHEN ${WITHOUT_DAMAGE_SQL} THEN 'withoutDamage' ELSE 'open' END`;
