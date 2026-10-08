import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { mapWithConcurrency } from '../../common/async/map-with-concurrency.js';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { ECUADOR_RINGS } from '../../common/geo/ecuador-boundary.js';
import { isInsideRings } from '../../common/geo/polygon.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { createColorRamp } from '../../common/raster/color-ramp.js';
import { gridMax, sumGrids, valueAt, type RasterGrid } from '../../common/raster/raster-grid.js';
import { renderGridPng } from '../../common/raster/render-png.js';
import { ObservedRainSource, type ObservedRainProduct } from './observed-rain-source.js';

/** Ventanas ofrecidas, en horas. */
export const OBSERVED_HOURS = [24, 48, 72] as const;
export type ObservedHours = (typeof OBSERVED_HOURS)[number];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Si la última hora con datos es más vieja que esto, el producto se considera sin datos recientes. */
const STALE_AFTER_MS = 12 * HOUR_MS;
/** Proporción mínima de horas con datos para calcular una ventana (tolera algún hueco aislado). */
const MIN_COVERAGE = 0.9;
/** Descargas horarias simultáneas al GeoServer. */
const DOWNLOAD_CONCURRENCY = 6;
/**
 * La grilla del satélite es de ~4 km: se suaviza (interpolación bilineal) y se
 * recorta al contorno del Ecuador, como el mapa oficial del INAMHI.
 */
const RENDER_OPTIONS = { scale: 4, smooth: true, clip: ECUADOR_RINGS } as const;

export interface ObservedWindowStatus {
  hours: ObservedHours;
  available: boolean;
  /** Primera y última hora con datos de la ventana (ISO 8601). */
  from: string | null;
  to: string | null;
  /** Horas sin dato dentro de la ventana (0 si está completa). */
  missingHours: number;
}

export interface ObservedProductStatus extends ObservedRainProduct {
  /** Última hora con datos (ISO 8601), o null si no hay ninguna. */
  latest: string | null;
  /** true si `latest` es demasiado antigua: no se ofrece como lluvia reciente. */
  isStale: boolean;
  windows: ObservedWindowStatus[];
}

export interface ObservedRainAvailability {
  products: ObservedProductStatus[];
}

export interface ObservedAccumulatedRain {
  product: string;
  hours: ObservedHours;
  from: string;
  to: string;
  missingHours: number;
  /** [[sur, oeste], [norte, este]] para superponer la imagen en el mapa. */
  bounds: [[number, number], [number, number]];
  /** Lluvia máxima acumulada en una celda (mm). */
  maxMm: number;
  /** Ruta (relativa a la API) de la imagen PNG. */
  imagePath: string;
}

/** Lluvia observada acumulada en un punto. */
export interface ObservedRainPoint {
  product: string;
  hours: ObservedHours;
  from: string;
  to: string;
  /** Lluvia acumulada en la celda del punto (mm); null fuera del Ecuador o sin dato. */
  mm: number | null;
}

interface Rendered {
  meta: ObservedAccumulatedRain;
  png: Buffer;
  grid: RasterGrid;
}

export interface HourlyWindow {
  times: string[];
  from: string;
  to: string;
  missingHours: number;
}

/**
 * Horas de la ventana de `hours` horas que termina en la última hora con datos:
 * para 24 h, los 24 pasos horarios hasta el más reciente. Null si faltan
 * demasiadas horas para que la suma sea confiable.
 */
export function selectHourlyWindow(times: readonly string[], hours: number): HourlyWindow | null {
  const latest = times.at(-1);
  if (!latest) return null;
  const end = Date.parse(latest);
  const start = end - (hours - 1) * HOUR_MS;
  const inWindow = times.filter((time) => {
    const ms = Date.parse(time);
    return ms >= start && ms <= end;
  });
  if (inWindow.length < hours * MIN_COVERAGE) return null;
  return {
    times: inWindow,
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    missingHours: Math.max(0, hours - inWindow.length),
  };
}

/**
 * Lluvia OBSERVADA acumulada en las últimas 24/48/72 h, calculada aquí sumando
 * las grillas horarias del satélite hasta la última hora disponible (los
 * productos de 24/48/72 h del INAMHI se actualizan una vez al día y no llegan
 * a las últimas horas). Cada hora se descarga una sola vez; el resultado se
 * cachea hasta que llega una hora nueva.
 */
@Injectable()
export class ObservedRainService {
  private readonly renderCache = new TtlCache<Rendered>(2 * HOUR_MS, 12);

  constructor(private readonly source: ObservedRainSource) {}

  async availability(): Promise<ObservedRainAvailability> {
    const products = await Promise.all(this.source.products.map((product) => this.status(product)));
    return { products };
  }

  async accumulated(product: string, hours: ObservedHours): Promise<ObservedAccumulatedRain> {
    return (await this.render(product, hours)).meta;
  }

  async image(product: string, hours: ObservedHours): Promise<Buffer> {
    return (await this.render(product, hours)).png;
  }

  async valueAt(product: string, hours: ObservedHours, lat: number, lng: number): Promise<ObservedRainPoint> {
    const { meta, grid } = await this.render(product, hours);
    const value = isInsideRings(ECUADOR_RINGS, lng, lat) ? valueAt(grid, lat, lng) : null;
    return {
      product: meta.product,
      hours,
      from: meta.from,
      to: meta.to,
      mm: value === null ? null : Math.round(value * 10) / 10,
    };
  }

  private async status(product: ObservedRainProduct): Promise<ObservedProductStatus> {
    // Si un producto falla, se informa sin datos en vez de tumbar la respuesta completa.
    const times = await this.source.getHourlyTimes(product.key).catch(() => [] as string[]);
    const latest = times.at(-1) ?? null;
    const isStale = !latest || Date.parse(latest) < Date.now() - STALE_AFTER_MS;
    return {
      ...product,
      latest,
      isStale,
      windows: OBSERVED_HOURS.map((hours) => {
        const window = isStale ? null : selectHourlyWindow(times, hours);
        return {
          hours,
          available: window !== null,
          from: window?.from ?? null,
          to: window?.to ?? null,
          missingHours: window?.missingHours ?? 0,
        };
      }),
    };
  }

  private async render(productKey: string, hours: ObservedHours): Promise<Rendered> {
    const product = this.source.products.find((candidate) => candidate.key === productKey);
    if (!product) throw new NotFoundException(`No existe el producto de lluvia observada "${productKey}"`);

    const times = await this.upstream(this.source.getHourlyTimes(product.key));
    const latest = times.at(-1);
    if (!latest || Date.parse(latest) < Date.now() - STALE_AFTER_MS) {
      throw new NotFoundException(`${product.name} no tiene datos recientes`);
    }
    const window = selectHourlyWindow(times, hours);
    if (!window) throw new NotFoundException(`${product.name} no tiene suficientes horas para ${hours} h`);

    return this.upstream(
      this.renderCache.get(`${product.key}:${hours}:${window.to}`, async () => {
        const [grids, stops] = await Promise.all([
          mapWithConcurrency(window.times, DOWNLOAD_CONCURRENCY, (time) => this.source.getHourlyGrid(product.key, time)),
          this.source.getColorStops(product.key),
        ]);
        const total = sumGrids(grids);
        const [west, south, east, north] = total.bbox;
        return {
          png: renderGridPng(total, createColorRamp(stops), RENDER_OPTIONS),
          grid: total,
          meta: {
            product: product.key,
            hours,
            from: window.from,
            to: window.to,
            missingHours: window.missingHours,
            bounds: [
              [south, west],
              [north, east],
            ],
            maxMm: Math.round(gridMax(total) * 10) / 10,
            imagePath: `/observed-rain/${product.key}/accumulated/${hours}/image?to=${encodeURIComponent(window.to)}`,
          },
        };
      }),
    );
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
