import { NotFoundException } from '@nestjs/common';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { RainForecastSource, type ForecastRun } from './rain-forecast-source.js';
import { RainForecastService } from './rain-forecast.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN = '2026-10-05T07:00:00.000Z';
const dayTime = (day: number) => new Date(Date.parse(RUN) + day * DAY_MS).toISOString();

/** Cada día llueve distinto: 10 mm el día 1, 20 mm el día 2. */
const grid = (mm: number): RasterGrid => ({
  width: 2,
  height: 1,
  bbox: [-79, -2, -78, -1],
  values: Float64Array.from([mm, 0]),
  noData: -9999,
});

class FakeSource extends RainForecastSource {
  readonly attribution = 'prueba';
  readonly requested: string[] = [];

  constructor(private readonly run: ForecastRun) {
    super();
  }

  async getLatestRun() {
    return this.run;
  }

  async getDailyGrid(_run: string, time: string) {
    this.requested.push(time);
    return grid(time === dayTime(1) ? 10 : 20);
  }

  async getColorStops() {
    return [{ value: 1, color: '#0000ff', opacity: 1 }];
  }
}

describe('RainForecastService', () => {
  const build = () => {
    const source = new FakeSource({ run: RUN, dailyTimes: [dayTime(1), dayTime(2)] });
    return { source, service: new RainForecastService(source) };
  };

  it('informa cada día con sus propias 24 h', async () => {
    const { days } = await build().service.availability();
    expect(days).toEqual([
      { day: 1, available: true, from: RUN, to: dayTime(1) },
      { day: 2, available: true, from: dayTime(1), to: dayTime(2) },
      { day: 3, available: false, from: null, to: null },
    ]);
  });

  it('el día 2 muestra solo la lluvia de ese día, sin sumar el día 1', async () => {
    const { source, service } = build();
    const result = await service.daily(2);

    expect(source.requested).toEqual([dayTime(2)]);
    expect(result).toMatchObject({ day: 2, from: dayTime(1), to: dayTime(2), maxMm: 20 });
    expect(result.imagePath).toBe(`/rain-forecast/days/2/image?run=${encodeURIComponent(RUN)}`);
  });

  it('responde 404 si la corrida no llega a ese día', async () => {
    await expect(build().service.daily(3)).rejects.toBeInstanceOf(NotFoundException);
  });
});
