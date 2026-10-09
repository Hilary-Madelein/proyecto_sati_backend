import { Injectable } from '@nestjs/common';
import { mapWithConcurrency } from '../../common/async/map-with-concurrency.js';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { ColorStop } from '../../common/raster/color-ramp.js';
import { readGeoTiffGrid } from '../../common/raster/geotiff.js';
import { sumGrids, type RasterGrid } from '../../common/raster/raster-grid.js';
import { parseWmsLayerDimensions } from '../../common/wms/wms-capabilities.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { RainForecastSource, type ForecastRun } from '../../modules/rain-forecast/rain-forecast-source.js';

const SERVICE = 'WRF INAMHI (geoservicios)';
const LAYER = 'wrf_tiempo_precipitacion';
const COVERAGE_ID = `geonode__${LAYER}`;
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 3 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;
/** Horizonte de cada corrida del WRF del INAMHI: 72 h (3 días). */
const HORIZON_MS = 72 * HOUR_MS;
const DAYS = [1, 2, 3] as const;

/**
 * Paleta oficial de la lluvia diaria del INAMHI (la de su capa
 * `wrf_precipitation_daily`), fija aquí para no depender de otro servidor.
 */
export const INAMHI_DAILY_RAIN_STOPS: readonly ColorStop[] = [
  { value: 1.01, color: '#75BAFF', opacity: 1 },
  { value: 3.75, color: '#359AFF', opacity: 1 },
  { value: 7.5, color: '#0087FF', opacity: 1 },
  { value: 11.25, color: '#0674C6', opacity: 1 },
  { value: 15, color: '#0C608D', opacity: 1 },
  { value: 18.75, color: '#148F1B', opacity: 1 },
  { value: 22.5, color: '#1ACF05', opacity: 1 },
  { value: 26.25, color: '#63ED07', opacity: 1 },
  { value: 30, color: '#B1F119', opacity: 1 },
  { value: 33.75, color: '#D5F775', opacity: 1 },
  { value: 37.5, color: '#FFF42B', opacity: 1 },
  { value: 41.25, color: '#FFCB4D', opacity: 1 },
  { value: 45, color: '#FB9A6F', opacity: 1 },
  { value: 48.75, color: '#F96D73', opacity: 1 },
  { value: 52.5, color: '#F84E78', opacity: 1 },
  { value: 56.25, color: '#F71E54', opacity: 1 },
  { value: 60, color: '#BF0000', opacity: 1 },
  { value: 63.75, color: '#880000', opacity: 1 },
  { value: 67.5, color: '#640000', opacity: 1 },
  { value: 71.25, color: '#2D0000', opacity: 1 },
  { value: 75, color: '#2D0000', opacity: 1 },
];

const iso = (ms: number) => new Date(ms).toISOString();

/** Los 8 pasos de 3 h que forman las 24 h que terminan en `end` (cada paso es la lluvia de las 3 h que terminan en él). */
export function stepsOfDay(end: string): string[] {
  const endMs = Date.parse(end);
  return Array.from({ length: 8 }, (_, index) => iso(endMs - DAY_MS + (index + 1) * STEP_MS));
}

/**
 * Corrida vigente a partir de los pasos de 3 h publicados. El servidor no dice
 * cuándo empezó la corrida (no tiene la dimensión INITD): se deduce como el
 * último paso menos el horizonte de 72 h. Los días son las 24 h que siguen al
 * inicio, y solo se ofrecen los que tienen sus 8 pasos completos.
 */
export function runFromSteps(times: readonly string[]): ForecastRun | null {
  if (times.length === 0) return null;
  const available = new Set(times.map((time) => Date.parse(time)));
  const last = Math.max(...available);
  const start = last - HORIZON_MS;
  const dailyTimes = DAYS.map((day) => iso(start + day * DAY_MS)).filter((end) =>
    stepsOfDay(end).every((step) => available.has(Date.parse(step))),
  );
  return { run: iso(start), dailyTimes };
}

/**
 * Lluvia pronosticada del WRF del INAMHI desde su propio catálogo
 * (geoservicios.inamhi.gob.ec, dataset 355): pasos de 3 h, actualizados a
 * diario, ~7 días atrás y 3 adelante. La lluvia de cada día es la suma de sus
 * 8 pasos de 3 h. No guarda corridas pasadas: para el histórico ver el
 * archivo de lluvia (repositorio sati-archivo-lluvia).
 */
@Injectable()
export class InamhiCatalogRainForecastSource extends RainForecastSource {
  readonly attribution = 'Lluvia pronosticada: INAMHI · modelo WRF';
  // Un paso de 3 h no cambia mientras siga la misma corrida.
  private readonly stepCache = new TtlCache<RasterGrid>(3 * HOUR_MS, 30);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getLatestRun(): Promise<ForecastRun | null> {
    const url = new URL(this.config.get('INAMHI_WRF_WMS_URL'));
    url.searchParams.set('service', 'WMS');
    url.searchParams.set('version', '1.3.0');
    url.searchParams.set('request', 'GetCapabilities');
    const xml = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000 })).text();
    const dimensions = parseWmsLayerDimensions(xml, LAYER);
    return dimensions ? runFromSteps(dimensions.times) : null;
  }

  async getDailyGrid(_run: string, time: string): Promise<RasterGrid> {
    const steps = await mapWithConcurrency(stepsOfDay(time), 4, (step) => this.stepGrid(step));
    return sumGrids(steps);
  }

  async getColorStops(): Promise<ColorStop[]> {
    return [...INAMHI_DAILY_RAIN_STOPS];
  }

  private stepGrid(time: string): Promise<RasterGrid> {
    return this.stepCache.get(time, async () => {
      const url = new URL(this.config.get('INAMHI_WRF_WCS_URL'));
      url.searchParams.set('service', 'WCS');
      url.searchParams.set('version', '2.0.1');
      url.searchParams.set('request', 'GetCoverage');
      url.searchParams.set('coverageId', COVERAGE_ID);
      url.searchParams.set('format', 'image/tiff');
      // URLSearchParams codifica las comillas (%22): el servidor del INAMHI rechaza las comillas literales.
      url.searchParams.append('subset', `time("${time}")`);

      const buffer = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000, retries: 1 })).arrayBuffer();
      try {
        return await readGeoTiffGrid(buffer);
      } catch {
        throw new UpstreamError(SERVICE, `no hay datos de lluvia para ${time}`);
      }
    });
  }
}
