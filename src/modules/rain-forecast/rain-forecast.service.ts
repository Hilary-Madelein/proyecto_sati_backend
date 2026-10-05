import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { createColorRamp } from '../../common/raster/color-ramp.js';
import { gridMax, sumGrids } from '../../common/raster/raster-grid.js';
import { renderGridPng } from '../../common/raster/render-png.js';
import { RainForecastSource, type ForecastRun } from './rain-forecast-source.js';

/** Periodos de acumulación ofrecidos, en horas (múltiplos de un día). */
export const ACCUMULATION_HOURS = [24, 48, 72] as const;
export type AccumulationHours = (typeof ACCUMULATION_HOURS)[number];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Tolerancia al buscar el paso diario que corresponde a cada día de la corrida. */
const TIME_TOLERANCE_MS = HOUR_MS;
/** Si el último paso disponible ya pasó hace más de esto, el pronóstico está atrasado. */
const STALE_AFTER_MS = 3 * HOUR_MS;

export interface AccumulationPeriod {
  hours: AccumulationHours;
  available: boolean;
  /** Ventana acumulada: desde el inicio de la corrida hasta `to` (ISO 8601). */
  from: string | null;
  to: string | null;
}

export interface RainForecastAvailability {
  run: string | null;
  isStale: boolean;
  attribution: string;
  periods: AccumulationPeriod[];
}

export interface AccumulatedRain {
  run: string;
  hours: AccumulationHours;
  from: string;
  to: string;
  /** [[sur, oeste], [norte, este]] para superponer la imagen en el mapa. */
  bounds: [[number, number], [number, number]];
  /** Lluvia máxima acumulada en una celda (mm). */
  maxMm: number;
  /** Ruta (relativa a la API) de la imagen PNG. */
  imagePath: string;
}

interface Rendered {
  meta: AccumulatedRain;
  png: Buffer;
}

/**
 * Lluvia pronosticada ACUMULADA: 24 h = día 1 de la corrida; 48 h = día 1 +
 * día 2; 72 h = días 1 a 3. Descarga la lluvia diaria en grilla, la suma celda
 * a celda y la pinta con la paleta oficial. El resultado no cambia hasta que
 * llega una corrida nueva, así que se cachea por corrida.
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
      periods: ACCUMULATION_HOURS.map((hours) => {
        const times = run ? this.timesFor(run, hours) : null;
        return { hours, available: times !== null, from: times ? run!.run : null, to: times?.at(-1) ?? null };
      }),
    };
  }

  async accumulated(hours: AccumulationHours): Promise<AccumulatedRain> {
    return (await this.render(hours)).meta;
  }

  async image(hours: AccumulationHours): Promise<Buffer> {
    return (await this.render(hours)).png;
  }

  private async render(hours: AccumulationHours): Promise<Rendered> {
    const run = await this.latestRun();
    const times = run ? this.timesFor(run, hours) : null;
    if (!run || !times) throw new NotFoundException(`La corrida actual del modelo no llega a ${hours} h`);

    return this.upstream(
      this.renderCache.get(`${run.run}:${hours}`, async () => {
        const [grids, stops] = await Promise.all([
          Promise.all(times.map((time) => this.source.getDailyGrid(run.run, time))),
          this.source.getColorStops(),
        ]);
        const total = sumGrids(grids);
        const [west, south, east, north] = total.bbox;
        return {
          png: renderGridPng(total, createColorRamp(stops)),
          meta: {
            run: run.run,
            hours,
            from: run.run,
            to: times.at(-1)!,
            bounds: [
              [south, west],
              [north, east],
            ],
            maxMm: Math.round(gridMax(total) * 10) / 10,
            imagePath: `/rain-forecast/accumulated/${hours}/image?run=${encodeURIComponent(run.run)}`,
          },
        };
      }),
    );
  }

  /** Pasos diarios 1…N de la corrida, o null si falta alguno. */
  private timesFor(run: ForecastRun, hours: AccumulationHours): string[] | null {
    const start = Date.parse(run.run);
    const times: string[] = [];
    for (let day = 1; day <= hours / 24; day++) {
      const target = start + day * DAY_MS;
      const time = run.dailyTimes.find((candidate) => Math.abs(Date.parse(candidate) - target) <= TIME_TOLERANCE_MS);
      if (!time) return null;
      times.push(time);
    }
    return times;
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
