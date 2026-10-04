import { HazardEventEntity } from '../../modules/events/entities/hazard-event.entity.js';
import { InMemoryEventStore } from './in-memory-event.store.js';

const makeEvent = (overrides: Partial<HazardEventEntity>): HazardEventEntity =>
  Object.assign(new HazardEventEntity(), {
    source: 'sngr',
    externalId: '1',
    hazardType: 'flood',
    severity: 'moderate',
    status: 'open',
    province: 'Los Ríos',
    location: { type: 'Point', coordinates: [-79.5, -1.8] },
    occurredAt: new Date('2026-10-02T12:00:00Z'),
    affected: 10,
    housesAffected: 2,
    evacuated: 0,
    deceased: 0,
    ...overrides,
  });

const window = { from: new Date('2026-09-25T00:00:00Z'), to: new Date('2026-10-03T00:00:00Z') };

describe('InMemoryEventStore', () => {
  it('asigna id al guardar y encuentra por fuente e id externo', async () => {
    const store = new InMemoryEventStore();
    const event = makeEvent({ externalId: '42' });
    await store.save({ upserts: [event], seenIds: [], seenAt: new Date() });

    expect(event.id).toBeTruthy();
    expect(await store.findExisting('sngr', ['42', '99'])).toEqual([event]);
    expect(await store.findById(event.id)).toBe(event);
  });

  it('filtra, ordena por fecha y pagina', async () => {
    const store = new InMemoryEventStore();
    await store.save({
      upserts: [
        makeEvent({ externalId: 'a', occurredAt: new Date('2026-10-01T00:00:00Z') }),
        makeEvent({ externalId: 'b', occurredAt: new Date('2026-10-02T00:00:00Z'), severity: 'critical' }),
        makeEvent({ externalId: 'c', occurredAt: new Date('2026-09-01T00:00:00Z') }),
        makeEvent({ externalId: 'd', province: 'Napo', location: { type: 'Point', coordinates: [-77.8, -0.99] } }),
      ],
      seenIds: [],
      seenAt: new Date(),
    });

    const all = await store.list(window, { limit: 10, offset: 0 });
    expect(all.total).toBe(3);
    expect(all.items.map((event) => event.externalId)).toEqual(['d', 'b', 'a']);

    expect((await store.list({ ...window, province: 'los ríos' }, { limit: 10, offset: 0 })).total).toBe(2);
    expect((await store.list({ ...window, severities: ['critical'] }, { limit: 10, offset: 0 })).total).toBe(1);
    expect((await store.list({ ...window, bbox: [-78.5, -1.5, -77, 0] }, { limit: 10, offset: 0 })).total).toBe(1);
    expect((await store.list(window, { limit: 1, offset: 1 })).items[0].externalId).toBe('b');
  });

  it('resume por severidad, tipo y provincia, y suma el impacto', async () => {
    const store = new InMemoryEventStore();
    await store.save({
      upserts: [makeEvent({ externalId: 'a' }), makeEvent({ externalId: 'b', severity: 'high', province: null, deceased: 1 })],
      seenIds: [],
      seenAt: new Date(),
    });

    expect(await store.summary(window)).toEqual({
      total: 2,
      bySeverity: { moderate: 1, high: 1 },
      byHazardType: { flood: 2 },
      byProvince: { 'Los Ríos': 1, 'Sin dato': 1 },
      impact: { affected: 20, housesAffected: 4, evacuated: 0, deceased: 1 },
    });
  });
});
