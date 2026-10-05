import type { ColorStop } from '../../common/raster/color-ramp.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';

export interface ObservedRainProduct {
  /** Clave estable, usada en las URLs (p. ej. "persiann"). */
  key: string;
  /** Nombre corto para mostrar (p. ej. "PERSIANN"). */
  name: string;
  attribution: string;
}

/**
 * Contrato de una fuente de lluvia OBSERVADA (ya caída) en grilla horaria. Hoy
 * la implementa PERSIANN del GeoServer del INAMHI; otra fuente
 * (p. ej. estaciones interpoladas) solo tiene que cumplir este contrato.
 */
export abstract class ObservedRainSource {
  /** Productos disponibles, en orden de preferencia (el primero es el sugerido). */
  abstract readonly products: readonly ObservedRainProduct[];
  /** Horas con datos del producto (ISO 8601), de la más antigua a la más reciente. */
  abstract getHourlyTimes(product: string): Promise<string[]>;
  /** Lluvia (mm) de la hora `time` del producto. Todas las horas tienen la misma grilla. */
  abstract getHourlyGrid(product: string, time: string): Promise<RasterGrid>;
  /** Paleta oficial con la que se pinta la lluvia acumulada del producto. */
  abstract getColorStops(product: string): Promise<ColorStop[]>;
}
