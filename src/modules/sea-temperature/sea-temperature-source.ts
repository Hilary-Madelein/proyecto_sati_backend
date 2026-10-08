import type { RasterGrid } from '../../common/raster/raster-grid.js';

/** Temperatura superficial del mar y su anomalía en un día, sobre la misma grilla. */
export interface SeaTemperatureField {
  /** Día del dato (ISO 8601). */
  time: string;
  /** Temperatura superficial (°C). */
  sst: RasterGrid;
  /** Diferencia con el promedio histórico del día (°C); positiva = más cálido de lo normal. */
  anomaly: RasterGrid;
}

/**
 * Contrato de una fuente de temperatura del mar frente a Ecuador. Hoy la
 * implementa NOAA OISST; cualquier otra (Copernicus, INOCAR…) solo tiene que
 * cumplir este contrato. Las celdas de tierra deben venir sin dato.
 */
export abstract class SeaTemperatureSource {
  abstract readonly attribution: string;
  /** Campo más reciente disponible. */
  abstract getLatest(): Promise<SeaTemperatureField>;
}
