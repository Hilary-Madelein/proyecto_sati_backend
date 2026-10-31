import type { HazardType } from './domain/hazard-type.js';
import type { EventStatus } from './domain/normalized-event.js';
import type { Severity } from './domain/severity.js';
import type { HazardEventEntity } from './entities/hazard-event.entity.js';

export interface EventFilters {
  from: Date;
  to: Date;
  province?: string;
  hazardTypes?: HazardType[];
  severities?: Severity[];
  status?: EventStatus;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox?: [number, number, number, number];
}

/**
 * Eventos de un día como los separa el panel de eventos del frontend: los
 * abiertos que muestra (por severidad), los abiertos sin afectaciones que oculta
 * por defecto (ver `isWithoutDamage`) y los cerrados, que no muestra.
 */
export interface DayStatusCounts {
  open: Record<string, number>;
  withoutDamage: number;
  closed: number;
}

export interface EventSummary {
  total: number;
  bySeverity: Record<string, number>;
  byHazardType: Record<string, number>;
  byProvince: Record<string, number>;
  /** Eventos por día en Ecuador (AAAA-MM-DD) y severidad; solo los días con eventos. */
  byDay: Record<string, Record<string, number>>;
  /** Eventos por día en Ecuador (AAAA-MM-DD), en los grupos del panel de eventos; solo los días con eventos. */
  byDayStatus: Record<string, DayStatusCounts>;
  /**
   * Eventos por bloques de 24 h contados hacia atrás desde `to` ("0" = las 24 h
   * hasta `to`, "1" = las 24 h anteriores…), en los grupos del panel de eventos;
   * solo los bloques con eventos. Con el mismo `to` que el panel (su hora de
   * consulta), el bloque "0" son sus "últimas 24 h", y los primeros 3 y 7 suman
   * sus "últimos 3 y 7 días".
   */
  byLast24h: Record<string, DayStatusCounts>;
  impact: { affected: number; housesAffected: number; evacuated: number; deceased: number };
}

export interface EventChanges {
  /** Eventos nuevos o modificados (los nuevos aún sin id). */
  upserts: HazardEventEntity[];
  /** Eventos sin cambios: solo se actualiza `lastSeenAt`. */
  seenIds: string[];
  seenAt: Date;
}

/**
 * Contrato de almacenamiento de eventos. El dominio depende de esta clase, no
 * de PostgreSQL: hay una implementación con base de datos y otra en memoria
 * (ver `src/storage/`), elegidas con la variable STORAGE.
 */
export abstract class EventStore {
  /** Eventos ya guardados de una fuente, por sus identificadores externos. */
  abstract findExisting(source: string, externalIds: string[]): Promise<HazardEventEntity[]>;
  /** Guarda los cambios de un lote. Los eventos nuevos quedan con su `id` asignado. */
  abstract save(changes: EventChanges): Promise<void>;
  abstract list(filters: EventFilters, page: { limit: number; offset: number }): Promise<{ items: HazardEventEntity[]; total: number }>;
  abstract findById(id: string): Promise<HazardEventEntity | null>;
  abstract summary(filters: EventFilters): Promise<EventSummary>;
}
