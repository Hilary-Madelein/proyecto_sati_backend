import { StationRainArchive, WeatherStationSource, type HourlyRain, type WeatherStation } from './weather-station-source.js';
import { coveredHours, mergeRain, summarizeRain, WeatherStationsService } from './weather-stations.service.js';

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

describe('coveredHours', () => {
  const until = Date.UTC(2026, 10, 2, 12);
  const rowsAgo = (hours: number) => new Map([[1, [{ time: new Date(until - hours * 3_600_000).toISOString(), mm: 1 }]]]);

  it('dice hasta dónde llegan los datos, entre lo que entrega la fuente y 24 h', () => {
    expect(coveredHours(new Map(), until, 12)).toBe(12);
    expect(coveredHours(rowsAgo(3), until, 12)).toBe(12);
    expect(coveredHours(rowsAgo(18), until, 12)).toBe(18);
    expect(coveredHours(rowsAgo(30), until, 12)).toBe(24);
  });
});

describe('mergeRain', () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 10, 2, hour)).toISOString();
  const [since, until] = [Date.UTC(2026, 10, 2, 0), Date.UTC(2026, 10, 2, 12)];

  it('une el archivo con la API, en orden y dentro de la ventana', () => {
    expect(
      mergeRain(
        [{ time: at(0), mm: 9 }, { time: at(1), mm: 1 }, { time: at(2), mm: 2 }],
        [{ time: at(3), mm: 3 }, { time: at(13), mm: 9 }],
        since,
        until,
      ),
    ).toEqual([{ time: at(1), mm: 1 }, { time: at(2), mm: 2 }, { time: at(3), mm: 3 }]);
  });

  it('en la misma hora manda la API, y el archivo solo completa lo que no trae', () => {
    expect(
      mergeRain(
        [{ time: at(1), mm: 1 }, { time: at(2), mm: 2 }, { time: at(3), mm: null }],
        [{ time: at(1), mm: 5 }, { time: at(2), mm: null }, { time: at(3), mm: 0 }],
        since,
        until,
      ),
    ).toEqual([{ time: at(1), mm: 5 }, { time: at(2), mm: 2 }, { time: at(3), mm: 0 }]);
  });
});

describe('WeatherStationsService', () => {
  const NOW = Date.UTC(2026, 9, 13, 12);
  const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
  class FakeArchive extends StationRainArchive {
    getHourlyRain = (): Promise<Map<number, HourlyRain[]>> => Promise.resolve(new Map([[1, [{ time: hoursAgo(23), mm: 4 }]]]));
  }
  class BrokenArchive extends StationRainArchive {
    getHourlyRain = (): Promise<Map<number, HourlyRain[]>> => Promise.reject(new Error('sin conexión'));
  }
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  class FakeSource extends WeatherStationSource {
    readonly attribution = 'Estaciones: prueba';
    readonly windowHours = 12;
    readonly asked: number[] = [];
    getStations = () => Promise.resolve([station(1, true), station(2, false), station(3, true)]);
    getRecentHourlyRain = (id: number): Promise<HourlyRain[]> => {
      this.asked.push(id);
      return id === 3 ? Promise.reject(new Error('sin respuesta')) : Promise.resolve([{ time: hoursAgo(5), mm: 2 }]);
    };
  }

  it('consulta solo las que transmiten y una que falla no impide mostrar las demás', async () => {
    const source = new FakeSource();
    const snapshot = await new WeatherStationsService(source, new BrokenArchive()).snapshot();

    expect(source.asked.sort()).toEqual([1, 3]);
    expect(snapshot.windowHours).toBe(12);
    expect(snapshot.stations.map((item) => [item.id, item.totalMm, item.hours.length])).toEqual([
      [1, 2, 1],
      [3, null, 0],
    ]);
  });

  it('entrega la última carga sin volver a consultar la fuente', async () => {
    const source = new FakeSource();
    const service = new WeatherStationsService(source, new FakeArchive());
    const [first, second] = await Promise.all([service.snapshot(), service.snapshot()]);
    const third = await service.snapshot();

    expect(source.asked.sort()).toEqual([1, 3]);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('completa con el archivo hasta donde llegue y aparte da las últimas 12 h, que usan las alertas', async () => {
    const snapshot = await new WeatherStationsService(new FakeSource(), new FakeArchive()).snapshot();
    const first = snapshot.stations.find(({ id }) => id === 1)!;
    expect(snapshot.windowHours).toBe(23);
    expect(first.hours).toEqual([{ time: hoursAgo(23), mm: 4 }, { time: hoursAgo(5), mm: 2 }]);
    expect(first.totalMm).toBe(6);
    expect(first.last12h).toEqual({ totalMm: 2, hoursWithData: 1 });
  });

  it('si el archivo falla sigue con lo de la API y la ventana lo dice', async () => {
    const snapshot = await new WeatherStationsService(new FakeSource(), new BrokenArchive()).snapshot();
    expect(snapshot.windowHours).toBe(12);
    expect(snapshot.stations.find(({ id }) => id === 1)?.totalMm).toBe(2);
  });
});
