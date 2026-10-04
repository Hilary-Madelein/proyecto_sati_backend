import { Injectable, Logger } from '@nestjs/common';
import { splitIntoDateRanges } from '../../common/time/ecuador-time.js';
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

@HazardEventSource()
@Injectable()
export class SngrEventSource implements HazardEventSourceAdapter {
  private readonly logger = new Logger(SngrEventSource.name);
  readonly descriptor: HazardEventSourceDescriptor;

  constructor(
    private readonly client: SngrClient,
    config: AppConfigService,
  ) {
    this.descriptor = {
      key: SNGR_SOURCE_KEY,
      name: 'SNGR · Eventos adversos',
      enabled: config.get('SNGR_ENABLED'),
      intervalMinutes: config.get('SNGR_SYNC_INTERVAL_MINUTES'),
      backfillDays: config.get('SNGR_BACKFILL_DAYS'),
      // La API filtra por día: se repite el último día para no perder actualizaciones.
      overlapHours: 24,
    };
  }

  async fetchEvents(window: SyncWindow): Promise<NormalizedEvent[]> {
    const ranges = splitIntoDateRanges(window.from, window.to, SngrClient.MAX_DAYS_PER_REQUEST);
    const records = new Map<string, unknown>();

    // En serie: la SNGR es lenta y no conviene cargarla con consultas en paralelo.
    for (const range of ranges) {
      for (const record of await this.client.fetchUpdatedBetween(range)) {
        const id = (record as { EventoID?: unknown } | null)?.EventoID;
        if (id !== undefined && id !== null) records.set(String(id), record);
      }
    }

    const events: NormalizedEvent[] = [];
    const discarded = new Map<string, number>();
    for (const record of records.values()) {
      const result = mapSngrEvent(record);
      if (result.ok) events.push(result.event);
      else discarded.set(result.reason, (discarded.get(result.reason) ?? 0) + 1);
    }

    if (discarded.size > 0) {
      const detail = [...discarded].map(([reason, total]) => `${total} por ${reason}`).join(', ');
      this.logger.warn(`Registros descartados: ${detail}`);
    }
    return events;
  }
}
