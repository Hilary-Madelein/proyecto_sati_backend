import type { HazardType } from './hazard-type.js';
import type { EventImpact, Severity } from './severity.js';

export type EventStatus = 'open' | 'closed';

/**
 * Evento ya traducido al modelo propio. Es lo único que una integración debe
 * producir: el resto del sistema (BD, API, notificaciones) no conoce la fuente.
 */
export interface NormalizedEvent {
  /** Clave de la fuente, p. ej. "sngr". */
  source: string;
  /** Identificador del evento en la fuente. Junto con `source` es único. */
  externalId: string;
  /** Código legible que muestra la fuente, si existe. */
  code: string | null;
  hazardType: HazardType;
  /** Severidad ya traducida por la fuente a la escala propia. */
  severity: Severity;
  /** Nivel oficial que asigna la fuente (p. ej. "Nivel 2" de la SNGR), si existe. */
  level: number | null;
  status: EventStatus;
  title: string;
  description: string | null;
  province: string | null;
  canton: string | null;
  sector: string | null;
  latitude: number;
  longitude: number;
  occurredAt: Date;
  impact: EventImpact;
  /** Registro original tal como llegó, para auditoría y para detectar cambios. */
  raw: unknown;
}
