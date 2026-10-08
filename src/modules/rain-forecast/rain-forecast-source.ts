import type { ColorStop } from '../../common/raster/color-ramp.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';

export interface ForecastRun {
  /** Inicio de la corrida del modelo (ISO 8601). */
  run: string;
  /** Pasos diarios de esa corrida (ISO 8601), de más antiguo a más reciente. Cada uno es lluvia de 24 h. */
  dailyTimes: string[];
}

/**
 * Contrato de una fuente de pronóstico de lluvia diaria en grilla. Hoy la
 * implementa el WRF del INAMHI; otro modelo solo tiene que cumplir este contrato.
 */
export abstract class RainForecastSource {
  abstract readonly attribution: string;
  /** Corrida más reciente publicada, o null si no hay ninguna. */
  abstract getLatestRun(): Promise<ForecastRun | null>;
  /** Lluvia (mm) de las 24 h que terminan en `time`, de la corrida `run`. */
  abstract getDailyGrid(run: string, time: string): Promise<RasterGrid>;
  /** Paleta oficial con la que se pinta la lluvia. */
  abstract getColorStops(): Promise<ColorStop[]>;
}
