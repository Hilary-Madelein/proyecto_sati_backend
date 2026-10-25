import { hourlyResponseSchema, stationsResponseSchema, toHourlyRain, toWeatherStations } from './inamhi-stations.schema.js';

describe('toWeatherStations', () => {
  it('convierte las estaciones del INAMHI y descarta las sin coordenadas reales y las de prueba', () => {
    const response = stationsResponseSchema.parse({
      status: 'success',
      datos: [
        {
          codigo: 'M0033',
          id_estacion: 3,
          punto_obs: 'LOJA - LA ARGELIA',
          latitud: -4.0375,
          longitud: -79.2034,
          altitud: 2160.0,
          categoria: 'METEOROLOGICA',
          estado_estacion: 'OPERATIVA',
          estado_transmision: 'TRANSMITIENDO',
        },
        {
          codigo: 'H0148',
          id_estacion: 9,
          punto_obs: 'GUAYLLABAMBA DJ PISQUE',
          latitud: 0.03,
          longitud: -78.3,
          altitud: null,
          categoria: 'HIDROLOGICA',
          estado_transmision: 'NO APLICA',
        },
        { codigo: 'X', id_estacion: 10, punto_obs: 'SIN UBICACION', latitud: null, longitud: null, categoria: 'METEOROLOGICA' },
        { codigo: 'M5186', id_estacion: 11, punto_obs: 'M5186', latitud: 0, longitud: 0, categoria: 'METEOROLOGICA' },
        { codigo: 'PHM001', id_estacion: 12, punto_obs: 'Pruebas 1', latitud: -0.53, longitud: -78.54, categoria: 'HIDRO - METEOROLOGICA' },
      ],
    });

    expect(toWeatherStations(response)).toEqual([
      {
        id: 3,
        code: 'M0033',
        name: 'Loja - La Argelia',
        lat: -4.0375,
        lng: -79.2034,
        altitude: 2160,
        category: 'meteorological',
        transmitting: true,
      },
      {
        id: 9,
        code: 'H0148',
        name: 'Guayllabamba Dj Pisque',
        lat: 0.03,
        lng: -78.3,
        altitude: null,
        category: 'hydrological',
        transmitting: false,
      },
    ]);
  });
});

describe('toHourlyRain', () => {
  it('formato actual (desde el 25/10/2026): lee valor_1h y respeta la hora de Ecuador', () => {
    const response = hourlyResponseSchema.parse({
      status: 'success',
      datos: [
        { fecha_toma_dato: '2026-10-25T07:00:00-05:00', valor_1h: 0.07, nivel_calidad_1h: 1, estado_1h: '1' },
        { fecha_toma_dato: '2026-10-25T06:00:00-05:00', valor_1h: 3.04, nivel_calidad_1h: 1, estado_1h: '1' },
        { fecha_toma_dato: '2026-10-25T05:00:00-05:00', valor_1h: null },
      ],
    });

    // Consultado a las 07:40 de Ecuador (12:40 UTC).
    expect(toHourlyRain(response, Date.parse('2026-10-25T12:40:00Z'))).toEqual([
      { time: '2026-10-25T10:00:00.000Z', mm: null },
      { time: '2026-10-25T11:00:00.000Z', mm: 3.04 },
      { time: '2026-10-25T12:00:00.000Z', mm: 0.07 },
    ]);
  });

  it('formato viejo: lee 1h y la hora como UTC (la API la marcaba mal con -05:00); vacíos y negativos quedan sin dato', () => {
    const response = hourlyResponseSchema.parse({
      datos: [
        { fecha_toma_dato: '2026-10-13T03:00:00-05:00', '1h': 0.05 },
        { fecha_toma_dato: '2026-10-13T02:00:00-05:00', '1h': '0.21' },
        { fecha_toma_dato: '2026-10-13T04:00:00-05:00', '1h': null },
        { fecha_toma_dato: '2026-10-13T05:00:00-05:00', '1h': -99 },
      ],
    });

    // Consultado a las 00:55 de Ecuador (05:55 UTC): "05:00-05:00" leído con su desfase sería 10:00 UTC, en el futuro.
    expect(toHourlyRain(response, Date.parse('2026-10-13T05:55:00Z'))).toEqual([
      { time: '2026-10-13T02:00:00.000Z', mm: 0.21 },
      { time: '2026-10-13T03:00:00.000Z', mm: 0.05 },
      { time: '2026-10-13T04:00:00.000Z', mm: null },
      { time: '2026-10-13T05:00:00.000Z', mm: null },
    ]);
  });

  it('una respuesta sin datos da una lista vacía', () => {
    expect(toHourlyRain(hourlyResponseSchema.parse({ datos: [] }))).toEqual([]);
  });
});
