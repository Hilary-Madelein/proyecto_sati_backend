import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { ECUADOR_RINGS } from '../../common/geo/ecuador-boundary.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { createColorRamp } from '../../common/raster/color-ramp.js';
import { gridMax } from '../../common/raster/raster-grid.js';
import { renderGridPng } from '../../common/raster/render-png.js';
import { RainForecastSource, type ForecastRun } from './rain-forecast-source.js';

/** Días de pronóstico ofrecidos: 1 = las primeras 24 h de la corrida, 2 = las siguientes… */
export const FORECAST_DAYS = [1, 2, 3] as const;
export type ForecastDay = (typeof FORECAST_DAYS)[number];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Tolerancia al buscar el paso diario que corresponde a cada día de la corrida. */
const TIME_TOLERANCE_MS = HOUR_MS;
/** Si el último paso disponible ya pasó hace más de esto, el pronóstico está atrasado. */
const STALE_AFTER_MS = 3 * HOUR_MS;
/** Imagen suavizada y recortada al Ecuador, igual que la lluvia observada. */
const RENDER_OPTIONS = { scale: 3, smooth: true, clip: ECUADOR_RINGS } as const;

export interface ForecastDayStatus {
  day: ForecastDay;
  available: boolean;
  /** Las 24 h de ese día: desde `from` hasta `to` (ISO 8601). */
  from: string | null;
  to: string | null;
}

export interface RainForecastAvailability {
  run: string | null;
  isStale: boolean;
  attribution: string;
  days: ForecastDayStatus[];
}

export interface DailyRainForecast {
  run: string;
  day: ForecastDay;
  from: string;
  to: string;
  /** [[sur, oeste], [norte, este]] para superponer la imagen en el mapa. */
  bounds: [[number, number], [number, number]];
  /** Lluvia máxima del día en una celda (mm). */
  maxMm: number;
  /** Ruta (relativa a la API) de la imagen PNG. */
  imagePath: string;
}

interface Rendered {
  meta: DailyRainForecast;
  png: Buffer;
}

/**
 * Lluvia pronosticada DÍA POR DÍA: el día 2 muestra solo la lluvia de esas
 * 24 h, no la suma con el día 1 (sumar días hacía parecer que se venía una
 * tormenta enorme). Descarga la grilla diaria del modelo y la pinta con la
 * paleta oficial. No cambia hasta que llega una corrida nueva: se cachea por corrida.
 */
@Injectable()
export class RainForecastService {
  private readonly runCache = new TtlCache<ForecastRun | null>(10 * MINUTE_MS, 1);
  private readonly renderCache = new TtlCache<Rendered>(6 * HOUR_MS, 12);

  constructor(private readonly source: RainForecastSource) {}

  async availability(): Promise<RainForecastAvailability> {
    const run = await this.latestRun();
    const latest = run?.dailyTimes.at(-1);
    return {
      run: run?.run ?? null,
      isStale: !latest || Date.parse(latest) < Date.now() - STALE_AFTER_MS,
      attribution: this.source.attribution,
      days: FORECAST_DAYS.map((day) => {
        const time = run ? this.timeFor(run, day) : null;
        return {
          day,
          available: time !== null,
          from: time ? new Date(Date.parse(time) - DAY_MS).toISOString() : null,
          to: time,
        };
      }),
    };
  }

  async daily(day: ForecastDay): Promise<DailyRainForecast> {
    return (await this.render(day)).meta;
  }

  async image(day: ForecastDay): Promise<Buffer> {
    return (await this.render(day)).png;
  }

  private async render(day: ForecastDay): Promise<Rendered> {
    const run = await this.latestRun();
    const time = run ? this.timeFor(run, day) : null;
    if (!run || !time) throw new NotFoundException(`La corrida actual del modelo no llega al día ${day}`);

    return this.upstream(
      this.renderCache.get(`${run.run}:${day}`, async () => {
        const [grid, stops] = await Promise.all([this.source.getDailyGrid(run.run, time), this.source.getColorStops()]);
        const [west, south, east, north] = grid.bbox;
        return {
          png: renderGridPng(grid, createColorRamp(stops), RENDER_OPTIONS),
          meta: {
            run: run.run,
            day,
            from: new Date(Date.parse(time) - DAY_MS).toISOString(),
            to: time,
            bounds: [
              [south, west],
              [north, east],
            ],
            maxMm: Math.round(gridMax(grid) * 10) / 10,
            imagePath: `/rain-forecast/days/${day}/image?run=${encodeURIComponent(run.run)}`,
          },
        };
      }),
    );
  }

  /** Paso diario del día N de la corrida (lluvia de las 24 h que terminan en él), o null si no existe. */
  private timeFor(run: ForecastRun, day: ForecastDay): string | null {
    const target = Date.parse(run.run) + day * DAY_MS;
    return run.dailyTimes.find((candidate) => Math.abs(Date.parse(candidate) - target) <= TIME_TOLERANCE_MS) ?? null;
  }

  private latestRun(): Promise<ForecastRun | null> {
    return this.upstream(this.runCache.get('latest', () => this.source.getLatestRun()));
  }

  private async upstream<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }
}
