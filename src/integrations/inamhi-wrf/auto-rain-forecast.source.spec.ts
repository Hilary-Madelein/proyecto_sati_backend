import { describe, expect, it, vi } from 'vitest';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import type { ForecastRun, WindowRainGrid } from '../../modules/rain-forecast/rain-forecast-source.js';
import { AutoRainForecastSource } from './auto-rain-forecast.source.js';
import type { InamhiCatalogRainForecastSource } from './inamhi-catalog-rain-forecast.source.js';
import type { WrfRainForecastSource } from './wrf-rain-forecast.source.js';

const grid = (value: number): RasterGrid => ({ width: 1, height: 1, bbox: [0, 0, 1, 1], values: new Float64Array([value]), noData: -9999 }) as RasterGrid;
const run = (start: string): ForecastRun => ({ run: start, dailyTimes: [start] });
const window = (start: string): WindowRainGrid => ({ run: start, from: start, to: start, grid: grid(1) });

/** Una fuente simulada: corrida, días y ventana que se le indiquen (o un error). */
function fake(options: { run?: ForecastRun | null | Error; daily?: number; window?: WindowRainGrid | null | Error }) {
  return {
    attribution: 'x',
    getLatestRun: vi.fn(async () => {
      if (options.run instanceof Error) throw options.run;
      return options.run ?? null;
    }),
    getDailyGrid: vi.fn(async () => grid(options.daily ?? 0)),
    getNextHoursGrid: vi.fn(async () => {
      if (options.window instanceof Error) throw options.window;
      return options.window ?? null;
    }),
    getColorStops: vi.fn(async () => []),
  };
}

const auto = (inamhi: ReturnType<typeof fake>, geoglows: ReturnType<typeof fake>) =>
  new AutoRainForecastSource(inamhi as unknown as InamhiCatalogRainForecastSource, geoglows as unknown as WrfRainForecastSource);

describe('AutoRainForecastSource', () => {
  it('usa el servicio con la corrida más reciente', async () => {
    const inamhi = fake({ run: run('2026-11-09T01:00:00.000Z'), daily: 2 });
    const geoglows = fake({ run: run('2026-11-05T07:00:00.000Z'), daily: 1 });
    const source = auto(inamhi, geoglows);
    expect((await source.getLatestRun())?.run).toBe('2026-11-09T01:00:00.000Z');
    expect((await source.getDailyGrid('2026-11-09T01:00:00.000Z', 't')).values[0]).toBe(2);
  });

  it('si uno no responde, usa el otro', async () => {
    const inamhi = fake({ run: new Error('caído') });
    const geoglows = fake({ run: run('2026-11-05T07:00:00.000Z') });
    expect((await auto(inamhi, geoglows).getLatestRun())?.run).toBe('2026-11-05T07:00:00.000Z');
  });

  it('pide los días de una corrida al servicio del que salió', async () => {
    const inamhi = fake({ run: run('2026-11-09T01:00:00.000Z'), daily: 2 });
    const geoglows = fake({ run: run('2026-11-05T07:00:00.000Z'), daily: 1 });
    const source = auto(inamhi, geoglows);
    await source.getLatestRun();
    await source.getDailyGrid('2026-11-09T01:00:00.000Z', 't');
    expect(inamhi.getDailyGrid).toHaveBeenCalledTimes(1);
    expect(geoglows.getDailyGrid).not.toHaveBeenCalled();
  });

  it('la ventana sale del elegido y, si falla, del otro', async () => {
    const inamhi = fake({ run: run('2026-11-09T01:00:00.000Z'), window: new Error('caído') });
    const geoglows = fake({ run: run('2026-11-05T07:00:00.000Z'), window: window('2026-11-05T07:00:00.000Z') });
    const result = await auto(inamhi, geoglows).getNextHoursGrid(6, Date.now());
    expect(result?.run).toBe('2026-11-05T07:00:00.000Z');
    expect(inamhi.getNextHoursGrid).toHaveBeenCalledTimes(1);
  });

  it('en empate gana GeoGLOWS (dice qué corrida es y guarda las pasadas)', async () => {
    const same = '2026-11-09T01:00:00.000Z';
    const inamhi = fake({ run: run(same), daily: 2 });
    const geoglows = fake({ run: run(same), daily: 1 });
    const source = auto(inamhi, geoglows);
    await source.getLatestRun();
    expect((await source.getDailyGrid(same, 't')).values[0]).toBe(1);
  });

  it('si ninguno responde, avisa el error', async () => {
    await expect(auto(fake({ run: new Error('a') }), fake({ run: new Error('b') })).getLatestRun()).rejects.toThrow();
  });
});
