import { mapSngrEvent } from './sngr.mapper.js';

const baseRecord = {
  EventoID: 12345,
  CodigoEvento: 'EV-2026-001',
  TipoEventoID: 1262,
  NivelDeEvento: 'Nivel 2',
  FechaDelEvento: '2026-10-01',
  HoraDelEvento: '9:40',
  Latitud: '-1.80',
  Longitud: '-79.53',
  Provincia: 'LOS RIOS',
  Canton: 'BABAHOYO',
  Sector: 'Barrio El Salto',
  Estado: 'Activo',
  Descripcion: 'Desbordamiento del río',
  PersonasAfectadasDirectamente: '150',
  ViviendasAfectadas: 30,
  PersonasEvacuadas: null,
  PersonasFallecidas: '',
  CampoNuevo: 'se conserva en raw',
};

describe('mapSngrEvent', () => {
  it('traduce un registro de la SNGR al modelo propio', () => {
    const result = mapSngrEvent(baseRecord);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event).toMatchObject({
      source: 'sngr',
      externalId: '12345',
      code: 'EV-2026-001',
      hazardType: 'flood',
      severity: 'high',
      level: 2,
      status: 'open',
      title: 'Inundación en Babahoyo',
      province: 'Los Rios',
      canton: 'Babahoyo',
      latitude: -1.8,
      longitude: -79.53,
      impact: { affected: 150, housesAffected: 30, evacuated: 0, deceased: 0 },
    });
    expect(result.event.occurredAt.toISOString()).toBe('2026-10-01T14:40:00.000Z');
    expect(result.event.raw).toBe(baseRecord);
  });

  it.each([
    ['Nivel 1', 'moderate', 1],
    ['Nivel 2', 'high', 2],
    ['Nivel 3', 'critical', 3],
    ['Nivel 4', 'critical', 4],
    [null, 'moderate', null],
  ])('usa el nivel oficial: %s -> %s', (nivel, severity, level) => {
    const result = mapSngrEvent({ ...baseRecord, NivelDeEvento: nivel });
    expect(result.ok && { severity: result.event.severity, level: result.event.level }).toEqual({ severity, level });
  });

  it('marca como cerrado el estado "Cierre"', () => {
    const result = mapSngrEvent({ ...baseRecord, Estado: 'Cierre' });
    expect(result.ok && result.event.status).toBe('closed');
  });

  it('usa "other" para tipos desconocidos', () => {
    const result = mapSngrEvent({ ...baseRecord, TipoEventoID: 9999 });
    expect(result.ok && result.event.hazardType).toBe('other');
  });

  it.each([
    ['coordenadas vacías', { Latitud: 0, Longitud: 0 }, 'coordenadas fuera de Ecuador'],
    ['fecha inválida', { FechaDelEvento: 'ayer' }, 'fecha inválida'],
    ['sin identificador', { EventoID: null }, 'formato inválido'],
  ])('descarta registros con %s', (_case, override, reason) => {
    expect(mapSngrEvent({ ...baseRecord, ...override })).toEqual({ ok: false, reason });
  });
});
