import { Injectable, Logger } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import type { ColorStop } from '../../common/raster/color-ramp.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { RainForecastSource, type ForecastRun, type WindowRainGrid } from '../../modules/rain-forecast/rain-forecast-source.js';
import { InamhiCatalogRainForecastSource } from './inamhi-catalog-rain-forecast.source.js';
import { WrfRainForecastSource } from './wrf-rain-forecast.source.js';

/** Cada cuánto se vuelve a comparar qué servicio tiene la corrida más reciente. */
const CHOICE_TTL_MS = 10 * 60 * 1000;
/** Corridas recordadas con su servicio (para pedir sus días al mismo). */
const MAX_REMEMBERED_RUNS = 20;

interface Candidate {
  name: string;
  source: RainForecastSource;
}

interface Choice extends Candidate {
  run: ForecastRun | null;
}

/**
 * Los dos servicios del mismo WRF del INAMHI (el visor oficial en GeoGLOWS y el
 * catálogo del INAMHI) dan la lluvia en la misma escala (ver
 * INAMHI_WRF_STEP_SCALE), pero a veces uno se atrasa o no responde. Esta fuente
 * usa el que tenga la corrida más reciente y, si falla, el otro: así no hace falta
 * cambiar RAIN_FORECAST_SOURCE a mano.
 */
@Injectable()
export class AutoRainForecastSource extends RainForecastSource {
  readonly attribution = 'Lluvia pronosticada: INAMHI · modelo WRF';
  private readonly logger = new Logger(AutoRainForecastSource.name);
  private readonly candidates: readonly Candidate[];
  private readonly choice = new TtlCache<Choice>(CHOICE_TTL_MS, 1);
  private readonly runOwners = new Map<string, RainForecastSource>();
  private lastName: string | null = null;

  constructor(inamhi: InamhiCatalogRainForecastSource, geoglows: WrfRainForecastSource) {
    super();
    // En empate gana GeoGLOWS: dice qué corrida es y guarda las pasadas.
    this.candidates = [
      { name: 'GeoGLOWS', source: geoglows },
      { name: 'catálogo del INAMHI', source: inamhi },
    ];
  }

  async getLatestRun(): Promise<ForecastRun | null> {
    return (await this.choose()).run;
  }

  /** Los días de una corrida se piden al servicio del que salió; si no se sabe, al elegido ahora. */
  async getDailyGrid(run: string, time: string): Promise<RasterGrid> {
    const owner = this.runOwners.get(run) ?? (await this.choose()).source;
    return owner.getDailyGrid(run, time);
  }

  /** Del servicio elegido y, si falla o no tiene los pasos, del otro. */
  async getNextHoursGrid(hours: number, now: number): Promise<WindowRainGrid | null> {
    const chosen = await this.choose().catch(() => null);
    const order = chosen ? [chosen, ...this.candidates.filter((candidate) => candidate.source !== chosen.source)] : this.candidates;
    let lastError: unknown = null;
    for (const { name, source } of order) {
      try {
        const window = await source.getNextHoursGrid(hours, now);
        if (window) return window;
      } catch (error) {
        lastError = error;
        this.logger.warn(`Ventana de ${hours} h: ${name} falló (${(error as Error).message}); se prueba con el otro servicio`);
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  /** La paleta oficial del visor (GeoGLOWS); si no responde, la misma, fija, del catálogo del INAMHI. */
  async getColorStops(): Promise<ColorStop[]> {
    const [geoglows, inamhi] = this.candidates;
    try {
      return await geoglows.source.getColorStops();
    } catch {
      return inamhi.source.getColorStops();
    }
  }

  /** El servicio con la corrida más reciente (con al menos un día); el que falle, no cuenta. */
  private choose(): Promise<Choice> {
    return this.choice.get('latest', async () => {
      const results = await Promise.allSettled(this.candidates.map((candidate) => candidate.source.getLatestRun()));
      let best: Choice | null = null;
      let firstError: unknown = null;
      results.forEach((result, index) => {
        const candidate = this.candidates[index];
        if (result.status === 'rejected') {
          firstError ??= result.reason;
          this.logger.warn(`${candidate.name} no respondió (${(result.reason as Error)?.message ?? result.reason})`);
          return;
        }
        const run = result.value;
        if (!run || run.dailyTimes.length === 0) return;
        if (!best?.run || Date.parse(run.run) > Date.parse(best.run.run)) best = { ...candidate, run };
      });
      if (!best) {
        if (firstError && results.every((result) => result.status === 'rejected')) throw firstError;
        return { ...this.candidates[0], run: null };
      }
      const chosen: Choice = best;
      if (chosen.run) this.remember(chosen.run.run, chosen.source);
      if (chosen.name !== this.lastName) {
        this.logger.log(`Lluvia pronosticada: ${chosen.name} (corrida ${chosen.run?.run})`);
        this.lastName = chosen.name;
      }
      return chosen;
    });
  }

  private remember(run: string, source: RainForecastSource) {
    this.runOwners.set(run, source);
    if (this.runOwners.size > MAX_REMEMBERED_RUNS) {
      const oldest = this.runOwners.keys().next().value;
      if (oldest !== undefined) this.runOwners.delete(oldest);
    }
  }
}
