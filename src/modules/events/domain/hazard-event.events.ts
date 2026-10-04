import type { HazardEventEntity } from '../entities/hazard-event.entity.js';
import type { EventStatus } from './normalized-event.js';
import type { Severity } from './severity.js';

/**
 * Avisos internos que emite el módulo de eventos (vía EventEmitter). Otros
 * módulos, como notificaciones, se suscriben con `@OnEvent(...)` sin depender
 * de la ingesta ni de las fuentes.
 */
export const HazardEventTopics = {
  created: 'hazard-event.created',
  updated: 'hazard-event.updated',
} as const;

export interface HazardEventCreated {
  event: HazardEventEntity;
}

export interface HazardEventUpdated {
  event: HazardEventEntity;
  previous: { severity: Severity; status: EventStatus };
}
