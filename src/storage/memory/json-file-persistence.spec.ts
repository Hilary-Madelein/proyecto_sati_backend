import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfigService } from '../../config/app-config.service.js';
import { HazardEventEntity } from '../../modules/events/entities/hazard-event.entity.js';
import { InMemoryEventStore } from './in-memory-event.store.js';
import { JsonFilePersistence } from './json-file-persistence.js';

describe('JsonFilePersistence + InMemoryEventStore', () => {
  let dir: string;
  const persistenceIn = (folder: string) =>
    new JsonFilePersistence({ get: () => folder } as unknown as AppConfigService);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sati-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('los eventos sobreviven a un reinicio (con sus fechas como Date)', async () => {
    const persistence = persistenceIn(dir);
    const store = new InMemoryEventStore(persistence);
    const occurredAt = new Date('2026-10-02T12:00:00Z');
    await store.save({
      upserts: [
        Object.assign(new HazardEventEntity(), {
          source: 'sngr',
          externalId: '7',
          occurredAt,
          lastSeenAt: occurredAt,
          updatedAt: occurredAt,
          location: { type: 'Point', coordinates: [-79.5, -1.8] },
        }),
      ],
      seenIds: [],
      seenAt: occurredAt,
    });
    persistence.onModuleDestroy(); // escribe lo pendiente, como al apagar el servidor

    const restarted = new InMemoryEventStore(persistenceIn(dir));
    const [restored] = await restarted.findExisting('sngr', ['7']);
    expect(restored.occurredAt).toEqual(occurredAt);
    expect(restored.occurredAt).toBeInstanceOf(Date);
  });

  it('con la carpeta vacía no guarda nada', async () => {
    const persistence = persistenceIn('');
    expect(persistence.load('events')).toBeNull();
  });
});
