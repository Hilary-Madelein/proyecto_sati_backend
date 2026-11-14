import { Injectable } from '@nestjs/common';
import type { Ring } from '../../common/geo/polygon.js';
import type { ColorStop } from '../../common/raster/color-ramp.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { ObservedRainSource, type ObservedRainProduct } from '../../modules/observed-rain/observed-rain-source.js';
import { PARDIG_CLIP } from '../google-pardig/pardig-grid.js';
import { PARDIG_PRODUCT, PardigRainSource } from '../google-pardig/pardig-rain.source.js';
import { SatelliteObservedRainSource } from './satellite-observed-rain.source.js';

/** Paleta de respaldo (mm), por si el INAMHI no entrega la suya: de lluvia ligera a extrema. */
const FALLBACK_STOPS: ColorStop[] = [
  { value: 1, color: '#9BEB4A', opacity: 1 },
  { value: 5, color: '#33DB80', opacity: 1 },
  { value: 10, color: '#00B4FF', opacity: 1 },
  { value: 25, color: '#0064FF', opacity: 1 },
  { value: 50, color: '#FFEB00', opacity: 1 },
  { value: 100, color: '#FF6400', opacity: 1 },
  { value: 200, color: '#AF0000', opacity: 1 },
];

/**
 * Las fuentes de lluvia observada juntas: los satélites del INAMHI (PERSIANN) y
 * PARDIG de Google. PERSIANN va primero (es el sugerido y el que usan los
 * cálculos); PARDIG se pinta con la misma paleta, para que se puedan comparar.
 */
@Injectable()
export class CombinedObservedRainSource extends ObservedRainSource {
  readonly products: readonly ObservedRainProduct[];

  constructor(
    private readonly satellite: SatelliteObservedRainSource,
    private readonly pardig: PardigRainSource,
  ) {
    super();
    this.products = [...satellite.products, PARDIG_PRODUCT];
  }

  async getHourlyTimes(product: string): Promise<string[]> {
    return product === PARDIG_PRODUCT.key ? this.pardig.hourlyTimes() : this.satellite.getHourlyTimes(product);
  }

  async getHourlyGrid(product: string, time: string): Promise<RasterGrid> {
    return product === PARDIG_PRODUCT.key ? this.pardig.hourlyGrid(time) : this.satellite.getHourlyGrid(product, time);
  }

  async getColorStops(product: string): Promise<ColorStop[]> {
    if (product !== PARDIG_PRODUCT.key) return this.satellite.getColorStops(product);
    const [first] = this.satellite.products;
    return first ? this.satellite.getColorStops(first.key).catch(() => FALLBACK_STOPS) : FALLBACK_STOPS;
  }

  /** PARDIG es mundial: además del continente, se muestra en el recuadro de Galápagos. */
  override getClip(product: string): readonly Ring[] {
    return product === PARDIG_PRODUCT.key ? PARDIG_CLIP : super.getClip(product);
  }
}
