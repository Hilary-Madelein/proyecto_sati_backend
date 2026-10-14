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
  it('ordena las horas, lee la hora como UTC (la API la marca mal con -05:00) y deja sin dato los vacíos y negativos', () => {
    const response = hourlyResponseSchema.parse({
      datos: [
        { fecha_toma_dato: '2026-10-13T03:00:00-05:00', '1h': 0.05 },
        { fecha_toma_dato: '2026-10-13T02:00:00-05:00', '1h': '0.21' },
        { fecha_toma_dato: '2026-10-13T04:00:00-05:00', '1h': null },
        { fecha_toma_dato: '2026-10-13T05:00:00-05:00', '1h': -99 },
      ],
    });

    expect(toHourlyRain(response)).toEqual([
      { time: '2026-10-13T02:00:00.000Z', mm: 0.21 },
      { time: '2026-10-13T03:00:00.000Z', mm: 0.05 },
      { time: '2026-10-13T04:00:00.000Z', mm: null },
      { time: '2026-10-13T05:00:00.000Z', mm: null },
    ]);
  });
});
