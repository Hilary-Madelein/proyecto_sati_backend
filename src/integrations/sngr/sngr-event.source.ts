import { Injectable, Logger } from '@nestjs/common';
import { toEcuadorDate } from '../../common/time/ecuador-time.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { NormalizedEvent } from '../../modules/events/domain/normalized-event.js';
import {
  HazardEventSource,
  type HazardEventSourceAdapter,
  type HazardEventSourceDescriptor,
  type SyncWindow,
} from '../../modules/ingestion/hazard-event-source.js';
import { SngrClient } from './sngr.client.js';
import { mapSngrEvent, SNGR_SOURCE_KEY } from './sngr.mapper.js';

const HOURS_PER_DAY = 24;

@HazardEventSource()
@Injectable()
export class SngrEventSource implements HazardEventSourceAdapter {
  private readonly logger = new Logger(SngrEventSource.name);
  readonly descriptor: HazardEventSourceDescriptor;

  constructor(
    private readonly client: SngrClient,
    config: AppConfigService,
  ) {
    const windowDays = config.get('SNGR_BACKFILL_DAYS');
    this.descriptor = {
      key: SNGR_SOURCE_KEY,
      name: 'SNGR · Eventos por lluvias',
      enabled: config.get('SNGR_ENABLED'),
      intervalMinutes: config.get('SNGR_SYNC_INTERVAL_MINUTES'),
      backfillDays: windowDays,
      // Cada sincronización relee los últimos `windowDays` días completos: así se
      // captan los cambios de eventos ya conocidos (Seguimiento → Cierre, nuevas
      // cifras). Son pocos registros y los que no cambian no se reescriben.
      overlapHours: windowDays * HOURS_PER_DAY,
    };
  }

  async fetchEvents(window: SyncWindow): Promise<NormalizedEvent[]> {
    const records = await this.client.fetchRainEvents({
      from: toEcuadorDate(window.from),
      to: toEcuadorDate(window.to),
    });

    const events = new Map<string, NormalizedEvent>();
    const discarded = new Map<string, number>();
    const unclassified = new Map<string, number>();
    let repeated = 0;

    for (const record of records) {
      const result = mapSngrEvent(record);
      if (!result.ok) {
        increment(discarded, result.reason);
        continue;
      }
      const { event } = result;
      if (events.has(event.externalId)) repeated++;
      events.set(event.externalId, event);
      if (event.hazardType === 'other') increment(unclassified, String((record as { Evento?: unknown }).Evento ?? 'sin nombre'));
    }

    if (discarded.size > 0) this.logger.warn(`Registros descartados: ${summarize(discarded)}`);
    if (repeated > 0) {
      this.logger.warn(`${repeated} registros repetidos (misma parroquia, tipo, fecha, hora y coordenadas): se guardó uno`);
    }
    if (unclassified.size > 0) this.logger.log(`Eventos guardados como "Otro": ${summarize(unclassified)}`);
    return [...events.values()];
  }
}

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** "fecha inválida (3), formato inválido (1)" · "Vendaval (12)". */
function summarize(counts: Map<string, number>): string {
  return [...counts].map(([key, total]) => `${key} (${total})`).join(', ');
}
