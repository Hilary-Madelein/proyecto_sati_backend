import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { HazardEventEntity } from '../../modules/events/entities/hazard-event.entity.js';
import { EventStore, type EventChanges, type EventFilters, type EventSummary } from '../../modules/events/event-store.js';

/**
 * Eventos en memoria: sirve para trabajar sin base de datos. Los datos se
 * pierden al reiniciar (la ingesta vuelve a cargarlos al arrancar).
 */
@Injectable()
export class InMemoryEventStore extends EventStore {
  private readonly byId = new Map<string, HazardEventEntity>();
  private readonly idByKey = new Map<string, string>();

  async findExisting(source: string, externalIds: string[]): Promise<HazardEventEntity[]> {
    return externalIds
      .map((externalId) => this.idByKey.get(`${source}:${externalId}`))
      .filter((id): id is string => id !== undefined)
      .map((id) => this.byId.get(id)!);
  }

  async save({ upserts, seenIds, seenAt }: EventChanges): Promise<void> {
    for (const event of upserts) {
      event.id ??= randomUUID();
      event.createdAt ??= seenAt;
      this.byId.set(event.id, event);
      this.idByKey.set(`${event.source}:${event.externalId}`, event.id);
    }
    for (const id of seenIds) {
      const event = this.byId.get(id);
      if (event) event.lastSeenAt = seenAt;
    }
  }

  async list(filters: EventFilters, page: { limit: number; offset: number }) {
    const matching = this.filter(filters).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return { items: matching.slice(page.offset, page.offset + page.limit), total: matching.length };
  }

  async findById(id: string): Promise<HazardEventEntity | null> {
    return this.byId.get(id) ?? null;
  }

  async summary(filters: EventFilters): Promise<EventSummary> {
    const events = this.filter(filters);
    const countBy = (key: (event: HazardEventEntity) => string | null) => {
      const counts: Record<string, number> = {};
      for (const event of events) {
        const value = key(event) ?? 'Sin dato';
        counts[value] = (counts[value] ?? 0) + 1;
      }
      return counts;
    };
    const sum = (key: 'affected' | 'housesAffected' | 'evacuated' | 'deceased') =>
      events.reduce((total, event) => total + event[key], 0);

    return {
      total: events.length,
      bySeverity: countBy((event) => event.severity),
      byHazardType: countBy((event) => event.hazardType),
      byProvince: countBy((event) => event.province),
      impact: {
        affected: sum('affected'),
        housesAffected: sum('housesAffected'),
        evacuated: sum('evacuated'),
        deceased: sum('deceased'),
      },
    };
  }

  private filter(filters: EventFilters): HazardEventEntity[] {
    const province = filters.province?.toLocaleLowerCase('es');
    return [...this.byId.values()].filter((event) => {
      const time = event.occurredAt.getTime();
      if (time < filters.from.getTime() || time > filters.to.getTime()) return false;
      if (province && event.province?.toLocaleLowerCase('es') !== province) return false;
      if (filters.hazardTypes?.length && !filters.hazardTypes.includes(event.hazardType)) return false;
      if (filters.severities?.length && !filters.severities.includes(event.severity)) return false;
      if (filters.status && event.status !== filters.status) return false;
      if (filters.bbox) {
        const [minLng, minLat, maxLng, maxLat] = filters.bbox;
        const [lng, lat] = event.location.coordinates;
        if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false;
      }
      return true;
    });
  }
}
