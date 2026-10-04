import { DiscoveryService } from '@nestjs/core';
import type { NormalizedEvent } from '../events/domain/normalized-event.js';

export interface HazardEventSourceDescriptor {
  /** Clave única y estable, p. ej. "sngr". Se guarda en cada evento. */
  key: string;
  /** Nombre legible para logs y la API de estado. */
  name: string;
  enabled: boolean;
  /** Cada cuánto se sincroniza. */
  intervalMinutes: number;
  /** Días hacia atrás en la primera sincronización (BD vacía para esta fuente). */
  backfillDays: number;
  /**
   * Cuánto se retrocede respecto al final de la última sincronización exitosa,
   * para no perder eventos cuando la fuente filtra por fecha y no por hora.
   */
  overlapHours: number;
}

export interface SyncWindow {
  from: Date;
  to: Date;
}

/**
 * Contrato que implementa cada fuente de eventos (SNGR hoy, otras mañana).
 * Solo debe traer los eventos de la ventana y traducirlos a `NormalizedEvent`;
 * guardar, detectar cambios y notificar lo hace el resto del sistema.
 */
export interface HazardEventSourceAdapter {
  readonly descriptor: HazardEventSourceDescriptor;
  fetchEvents(window: SyncWindow): Promise<NormalizedEvent[]>;
}

/**
 * Marca un provider como fuente de eventos. El módulo de ingesta descubre
 * todas las clases marcadas al arrancar y las programa automáticamente:
 *
 * ```ts
 * @HazardEventSource()
 * @Injectable()
 * export class MiFuente implements HazardEventSourceAdapter { … }
 * ```
 */
export const HazardEventSource = DiscoveryService.createDecorator<void>();
