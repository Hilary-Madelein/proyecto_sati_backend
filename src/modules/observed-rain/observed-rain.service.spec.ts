import { NotFoundException } from '@nestjs/common';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { ObservedRainSource } from './observed-rain-source.js';
import { ObservedRainService, selectHourlyWindow } from './observed-rain.service.js';

const HOUR_MS = 60 * 60 * 1000;

/** N horas consecutivas que terminan en `end`. */
function hoursUntil(end: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => new Date(end - (count - 1 - index) * HOUR_MS).toISOString());
}

const grid = (value: number): RasterGrid => ({
  width: 2,
  height: 1,
  bbox: [-80, -2, -79, -1],
  values: Float64Array.from([value, 0]),
  noData: -99,
});

class FakeSource extends ObservedRainSource {
  readonly products = [
    { key: 'fresco', name: 'Fresco', attribution: 'a' },
    { key: 'viejo', name: 'Viejo', attribution: 'b' },
  ];
  readonly gridRequests: string[] = [];

  constructor(private readonly times: Record<string, string[]>) {
    super();
  }

  async getHourlyTimes(product: string) {
    return this.times[product] ?? [];
  }

  async getHourlyGrid(product: string, time: string) {
    this.gridRequests.push(time);
    return grid(2);
  }

  async getColorStops() {
    return [{ value: 1, color: '#0000ff', opacity: 1 }];
  }
}

describe('selectHourlyWindow', () => {
  const end = Date.parse('2026-10-05T21:00:00Z');

  it('toma las últimas N horas hasta el dato más reciente', () => {
    const window = selectHourlyWindow(hoursUntil(end, 100), 24);
    expect(window).toEqual({
      times: hoursUntil(end, 24),
      from: '2026-10-04T22:00:00.000Z',
      to: '2026-10-05T21:00:00.000Z',
      missingHours: 0,
    });
  });

  it('tolera algún hueco y lo informa', () => {
    const times = hoursUntil(end, 24).filter((_, index) => index !== 5);
    expect(selectHourlyWindow(times, 24)?.missingHours).toBe(1);
  });

  it('no calcula la ventana si faltan demasiadas horas', () => {
    expect(selectHourlyWindow(hoursUntil(end, 20), 24)).toBeNull();
    expect(selectHourlyWindow([], 24)).toBeNull();
  });
});

describe('ObservedRainService', () => {
  const now = Date.now();
  const recentEnd = Math.floor(now / HOUR_MS) * HOUR_MS - HOUR_MS;
  const oldEnd = Date.parse('2026-03-04T00:00:00Z');

  const build = () => {
    const source = new FakeSource({ fresco: hoursUntil(recentEnd, 80), viejo: hoursUntil(oldEnd, 80) });
    return { source, service: new ObservedRainService(source) };
  };

  it('marca como sin datos recientes al producto que dejó de publicarse', async () => {
    const { products } = await build().service.availability();
    const [fresh, old] = products;

    expect(fresh).toMatchObject({ key: 'fresco', isStale: false, latest: new Date(recentEnd).toISOString() });
    expect(fresh.windows.map((window) => window.available)).toEqual([true, true, true]);
    expect(old).toMatchObject({ key: 'viejo', isStale: true, latest: '2026-03-04T00:00:00.000Z' });
    expect(old.windows.every((window) => !window.available)).toBe(true);
  });

  it('suma las horas de la ventana hasta la última hora', async () => {
    const { source, service } = build();
    const result = await service.accumulated('fresco', 48);

    expect(source.gridRequests).toHaveLength(48);
    expect(result).toMatchObject({ product: 'fresco', hours: 48, to: new Date(recentEnd).toISOString(), maxMm: 96 });
    expect(result.imagePath).toContain('/observed-rain/fresco/accumulated/48/image?to=');
  });

  it('reutiliza el acumulado mientras no llegue una hora nueva', async () => {
    const { source, service } = build();
    await service.accumulated('fresco', 24);
    await service.image('fresco', 24);
    expect(source.gridRequests).toHaveLength(24);
  });

  it.each([
    ['un producto viejo', 'viejo'],
    ['un producto desconocido', 'otro'],
  ])('responde 404 para %s', async (_case, product) => {
    await expect(build().service.accumulated(product, 24)).rejects.toBeInstanceOf(NotFoundException);
  });
});
