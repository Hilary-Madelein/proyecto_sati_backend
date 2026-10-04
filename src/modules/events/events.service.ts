import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { stableHash } from '../../common/crypto/stable-hash.js';
import { HazardEventTopics, type HazardEventCreated, type HazardEventUpdated } from './domain/hazard-event.events.js';
import type { NormalizedEvent } from './domain/normalized-event.js';
import { HazardEventEntity } from './entities/hazard-event.entity.js';
import { EventStore, type EventFilters, type EventSummary } from './event-store.js';

export type { EventFilters, EventSummary } from './event-store.js';

export interface UpsertResult {
  created: number;
  updated: number;
  unchanged: number;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly store: EventStore,
    private readonly emitter: EventEmitter2,
  ) {}

  /**
   * Guarda un lote de eventos de una misma fuente: inserta los nuevos,
   * actualiza los que cambiaron y solo marca como vistos los demás. Los avisos
   * `hazard-event.*` se emiten después de guardar.
   */
  async upsertMany(source: string, items: NormalizedEvent[]): Promise<UpsertResult> {
    const unique = new Map(items.map((item) => [item.externalId, item]));
    if (unique.size === 0) return { created: 0, updated: 0, unchanged: 0 };

    const now = new Date();
    const existing = await this.store.findExisting(source, [...unique.keys()]);
    const existingById = new Map(existing.map((entity) => [entity.externalId, entity]));

    const created: HazardEventEntity[] = [];
    const updated: HazardEventUpdated[] = [];
    const seenIds: string[] = [];

    for (const item of unique.values()) {
      const contentHash = stableHash(item.raw);
      const current = existingById.get(item.externalId);

      if (!current) {
        created.push(Object.assign(new HazardEventEntity(), this.toColumns(item, contentHash), { lastSeenAt: now, updatedAt: now }));
      } else if (current.contentHash !== contentHash) {
        const previous = { severity: current.severity, status: current.status };
        Object.assign(current, this.toColumns(item, contentHash), { lastSeenAt: now, updatedAt: now });
        updated.push({ event: current, previous });
      } else {
        seenIds.push(current.id);
      }
    }

    await this.store.save({ upserts: [...created, ...updated.map(({ event }) => event)], seenIds, seenAt: now });

    for (const event of created) {
      this.emitter.emit(HazardEventTopics.created, { event } satisfies HazardEventCreated);
    }
    for (const payload of updated) {
      this.emitter.emit(HazardEventTopics.updated, payload);
    }

    return { created: created.length, updated: updated.length, unchanged: seenIds.length };
  }

  list(filters: EventFilters, page: { limit: number; offset: number }) {
    return this.store.list(filters, page);
  }

  async findById(id: string): Promise<HazardEventEntity> {
    const event = await this.store.findById(id);
    if (!event) throw new NotFoundException(`No existe el evento ${id}`);
    return event;
  }

  summary(filters: EventFilters): Promise<EventSummary> {
    return this.store.summary(filters);
  }

  private toColumns(item: NormalizedEvent, contentHash: string): Partial<HazardEventEntity> {
    return {
      source: item.source,
      externalId: item.externalId,
      code: item.code,
      hazardType: item.hazardType,
      severity: item.severity,
      level: item.level,
      status: item.status,
      title: item.title.slice(0, 255),
      description: item.description,
      province: item.province,
      canton: item.canton,
      sector: item.sector?.slice(0, 255) ?? null,
      location: { type: 'Point', coordinates: [item.longitude, item.latitude] },
      occurredAt: item.occurredAt,
      affected: item.impact.affected,
      housesAffected: item.impact.housesAffected,
      evacuated: item.impact.evacuated,
      deceased: item.impact.deceased,
      raw: item.raw,
      contentHash,
    };
  }
}
