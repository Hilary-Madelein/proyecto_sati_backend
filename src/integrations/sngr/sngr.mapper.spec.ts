import { mapSngrEvent, NOT_A_FLOOD } from './sngr.mapper.js';
import { toIsoDate } from './sngr.schema.js';

/** Registro con la forma de POST /public/eventos_lluvias (datos de ejemplo). */
const baseRecord = {
  Canton: 'Babahoyo',
  CategoriaDelEvento: 'Natural',
  Causa: 'Condiciones Atmosféricas',
  CodificacionCantonal: '1201',
  CodificacionParroquial: '120150',
  CodificacionProvincial: '12',
  'Comunidad/Barrio/Sector': 'Barrio El Salto',
  Coordenadas: '-1.80,-79.53',
  DescripcionGeneralDeEvento: 'Desbordamiento del río',
  EstadoDelEvento: 'Seguimiento',
  Evento: 'Inundación',
  FechaDelEvento: '1/10/2026',
  FuentesDeInformacion: 'GAD Cantonal',
  HoraDelEvento: '9:40',
  Latitud: -1.8,
  Longitud: -79.53,
  NivelDelEvento: 'Nivel 2',
  Parroquia: 'Babahoyo',
  PersonasAfectadasDirectamente: '150',
  PersonasEvacuadas: null,
  PersonasFallecidas: '',
  Provincia: 'LOS RIOS',
  ViviendasAfectadas: '30',
  CampoNuevo: 'se conserva en raw',
};

describe('mapSngrEvent', () => {
  it('traduce un registro de la SNGR al modelo propio', () => {
    const result = mapSngrEvent(baseRecord);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event).toMatchObject({
      source: 'sngr',
      code: null,
      hazardType: 'river_flood',
      severity: 'high',
      level: 2,
      status: 'open',
      title: 'Desborde de río en Babahoyo',
      description: 'Desbordamiento del río',
      province: 'Los Rios',
      canton: 'Babahoyo',
      sector: 'Barrio El Salto',
      hasDamage: true,
      latitude: -1.8,
      longitude: -79.53,
      impact: { affected: 150, housesAffected: 30, evacuated: 0, deceased: 0, homeless: 0 },
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
    const result = mapSngrEvent({ ...baseRecord, NivelDelEvento: nivel });
    expect(result.ok && { severity: result.event.severity, level: result.event.level }).toEqual({ severity, level });
  });

  it('marca como cerrado el estado "Cierre"', () => {
    const result = mapSngrEvent({ ...baseRecord, EstadoDelEvento: 'Cierre' });
    expect(result.ok && result.event.status).toBe('closed');
  });

  it('no nombra el río en el título', () => {
    const description = 'Se produjo el desbordamiento del río La Clementina.';
    const result = mapSngrEvent({ ...baseRecord, DescripcionGeneralDeEvento: description });
    expect(result.ok && result.event.title).toBe('Desborde de río en Babahoyo');
  });

  it.each(['Deslizamiento', 'Vendaval', 'Granizada'])('descarta lo que no es inundación: %s', (Evento) => {
    expect(mapSngrEvent({ ...baseRecord, Evento })).toEqual({ ok: false, reason: NOT_A_FLOOD });
  });

  it('usa "Coordenadas" si faltan Latitud y Longitud', () => {
    const result = mapSngrEvent({ ...baseRecord, Latitud: null, Longitud: '', Coordenadas: '-2.022976,-77.951504' });
    expect(result.ok && [result.event.latitude, result.event.longitude]).toEqual([-2.022976, -77.951504]);
  });

  describe('identificador', () => {
    const idOf = (override: object) => {
      const result = mapSngrEvent({ ...baseRecord, ...override });
      return result.ok ? result.event.externalId : null;
    };

    it('no cambia con el seguimiento del evento (estado, cifras, descripción)', () => {
      expect(
        idOf({ EstadoDelEvento: 'Cierre', PersonasAfectadasDirectamente: '200', DescripcionGeneralDeEvento: 'Actualizado' }),
      ).toBe(idOf({}));
    });

    it('distingue eventos de otro tipo, fecha o lugar', () => {
      const ids = [idOf({}), idOf({ Evento: 'Inundación fluvial' }), idOf({ FechaDelEvento: '2/10/2026' }), idOf({ Latitud: -1.81 })];
      expect(new Set(ids).size).toBe(4);
    });
  });

  it.each([
    ['coordenadas vacías', { Latitud: 0, Longitud: 0 }, 'coordenadas fuera de Ecuador'],
    ['sin coordenadas', { Latitud: null, Longitud: null, Coordenadas: '' }, 'coordenadas fuera de Ecuador'],
    ['fecha inválida', { FechaDelEvento: 'ayer' }, 'fecha inválida'],
    ['fecha imposible', { FechaDelEvento: '31/9/2026' }, 'fecha inválida'],
  ])('descarta registros con %s', (_case, override, reason) => {
    expect(mapSngrEvent({ ...baseRecord, ...override })).toEqual({ ok: false, reason });
  });
});

describe('toIsoDate', () => {
  it.each([
    ['2/9/2026', '2026-09-02'],
    ['29/8/2026', '2026-08-29'],
    ['02/09/2026', '2026-09-02'],
    ['2026-09-02', '2026-09-02'],
    ['2026-09-02T00:00:00', '2026-09-02'],
    ['31/9/2026', null],
    ['9/2026', null],
    [null, null],
  ])('%s -> %s', (value, expected) => {
    expect(toIsoDate(value)).toBe(expected);
  });
});

