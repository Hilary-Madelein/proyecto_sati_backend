import type { ColorStop } from '../../common/raster/color-ramp.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';

const STEP_MS = 3 * 60 * 60 * 1000;

/** Lluvia pronosticada de una ventana de horas, en grilla. */
export interface WindowRainGrid {
  /** Corrida del modelo de la que salen los pasos (ISO 8601). */
  run: string;
  /** Inicio y fin de la ventana (ISO 8601). */
  from: string;
  to: string;
  grid: RasterGrid;
}

/**
 * Pasos de 3 h (cada uno etiquetado por su FIN) que forman las próximas `hours`
 * horas: desde el último fin de paso que ya pasó (o, si ninguno pasó, desde el
 * inicio del primero) hasta `hours` después. Null si faltan pasos.
 */
export function nextStepEnds(times: readonly string[], hours: number, now: number): string[] | null {
  const ends = new Set(times.map((time) => Date.parse(time)).filter(Number.isFinite));
  if (ends.size === 0) return null;
  const sorted = [...ends].sort((a, b) => a - b);
  const start = sorted.filter((end) => end <= now).at(-1) ?? sorted[0] - STEP_MS;
  const wanted = Array.from({ length: Math.round((hours * 60 * 60 * 1000) / STEP_MS) }, (_, index) => start + (index + 1) * STEP_MS);
  return wanted.every((end) => ends.has(end)) ? wanted.map((end) => new Date(end).toISOString()) : null;
}

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
  /**
   * Lluvia (mm) de las próximas `hours` horas desde `now` (múltiplo de 3), con los
   * pasos de 3 h de la corrida más reciente y en la misma escala que la diaria.
   * Null si la corrida no tiene todos esos pasos.
   */
  abstract getNextHoursGrid(hours: number, now: number): Promise<WindowRainGrid | null>;
  /** Paleta oficial con la que se pinta la lluvia. */
  abstract getColorStops(): Promise<ColorStop[]>;
}
