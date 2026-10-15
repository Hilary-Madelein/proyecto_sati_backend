import { WeatherStationSource, type HourlyRain, type WeatherStation } from './weather-station-source.js';
import { summarizeRain, WeatherStationsService } from './weather-stations.service.js';

const station = (id: number, transmitting: boolean): WeatherStation => ({
  id,
  code: `M${id}`,
  name: `Estación ${id}`,
  lat: -1,
  lng: -78,
  altitude: null,
  category: 'meteorological',
  transmitting,
});

describe('summarizeRain', () => {
  it('suma solo las horas con dato y da la última hora con dato', () => {
    expect(
      summarizeRain([
        { time: '2026-10-13T07:00:00.000Z', mm: 0.21 },
        { time: '2026-10-13T08:00:00.000Z', mm: 1.19 },
        { time: '2026-10-13T09:00:00.000Z', mm: null },
      ]),
    ).toEqual({ totalMm: 1.4, hoursWithData: 2, lastTime: '2026-10-13T08:00:00.000Z' });
  });

  it('sin ninguna hora con dato el total es null, no 0', () => {
    expect(summarizeRain([{ time: '2026-10-13T07:00:00.000Z', mm: null }])).toEqual({
      totalMm: null,
      hoursWithData: 0,
      lastTime: null,
    });
  });
});

describe('WeatherStationsService', () => {
  class FakeSource extends WeatherStationSource {
    readonly attribution = 'Estaciones: prueba';
    readonly windowHours = 12;
    readonly asked: number[] = [];
    getStations = () => Promise.resolve([station(1, true), station(2, false), station(3, true)]);
    getRecentHourlyRain = (id: number): Promise<HourlyRain[]> => {
      this.asked.push(id);
      return id === 3 ? Promise.reject(new Error('sin respuesta')) : Promise.resolve([{ time: '2026-10-13T07:00:00.000Z', mm: 2 }]);
    };
  }

  it('consulta solo las que transmiten y una que falla no impide mostrar las demás', async () => {
    const source = new FakeSource();
    const snapshot = await new WeatherStationsService(source).snapshot();

    expect(source.asked.sort()).toEqual([1, 3]);
    expect(snapshot.windowHours).toBe(12);
    expect(snapshot.stations.map((item) => [item.id, item.totalMm, item.hours.length])).toEqual([
      [1, 2, 1],
      [3, null, 0],
    ]);
  });

  it('entrega la última carga sin volver a consultar la fuente', async () => {
    const source = new FakeSource();
    const service = new WeatherStationsService(source);
    const [first, second] = await Promise.all([service.snapshot(), service.snapshot()]);
    const third = await service.snapshot();

    expect(source.asked.sort()).toEqual([1, 3]);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
