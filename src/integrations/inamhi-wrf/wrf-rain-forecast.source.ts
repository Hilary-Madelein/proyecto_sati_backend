import { Injectable } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { ColorStop } from '../../common/raster/color-ramp.js';
import { readGeoTiffGrid } from '../../common/raster/geotiff.js';
import { sumGrids, type RasterGrid } from '../../common/raster/raster-grid.js';
import { colorStopsFromLegendGraphic, type LegendGraphicJson } from '../../common/wms/legend-graphic.js';
import { parseWmsLayerDimensions } from '../../common/wms/wms-capabilities.js';
import { AppConfigService } from '../../config/app-config.service.js';
import {
  RainForecastSource,
  nextStepEnds,
  type ForecastRun,
  type WindowRainGrid,
} from '../../modules/rain-forecast/rain-forecast-source.js';

const SERVICE = 'WRF INAMHI';
/**
 * Capa de lluvia diaria. Cada paso es la lluvia de las 24 h que EMPIEZAN en él:
 * la suma de los pasos de 3 h siguientes coincide con él (comprobado con las
 * grillas), y la corrida trae los días que empiezan en su inicio, +24 h y +48 h.
 */
const LAYER = 'wrf_precipitation_daily';
const COVERAGE_ID = `wrf__${LAYER}`;
/**
 * Capa de pasos de 3 h. Cada paso es la lluvia de las 3 h que TERMINAN en él, y la
 * corrida va con su propio INITD (01Z, no 07Z como la diaria). Viene a la mitad de
 * escala: el día de la capa diaria es 2 × la suma de sus 8 pasos (comprobado con
 * las corridas del 13, 16 y 20 oct 2026 del archivo de lluvia; correlación 1,00).
 */
const STEP_LAYER = 'wrf_precipitation';
const STEP_COVERAGE_ID = `wrf__${STEP_LAYER}`;
const STEP_SCALE = 2;
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 3 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Lluvia diaria del modelo WRF del INAMHI, la misma que muestra su visor oficial
 * (inamhi.geoglows.org; GeoServer servido por GEOGLOWS):
 * corridas por el GetCapabilities WMS, valores por WCS (GeoTIFF) y paleta por
 * GetLegendGraphic, para que el acumulado se vea igual que las capas oficiales.
 */
@Injectable()
export class WrfRainForecastSource extends RainForecastSource {
  readonly attribution = 'Lluvia pronosticada: INAMHI · modelo WRF';
  // Una grilla de una corrida no cambia: se guarda varias horas.
  private readonly gridCache = new TtlCache<RasterGrid>(6 * HOUR_MS, 12);
  private readonly stopsCache = new TtlCache<ColorStop[]>(24 * HOUR_MS, 1);
  private readonly stepRunCache = new TtlCache<{ run: string; times: string[] } | null>(HOUR_MS / 2, 1);
  private readonly stepGridCache = new TtlCache<RasterGrid>(6 * HOUR_MS, 40);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getLatestRun(): Promise<ForecastRun | null> {
    const url = new URL(this.config.get('GEOGLOWS_WRF_WMS_URL'));
    url.searchParams.set('SERVICE', 'WMS');
    url.searchParams.set('VERSION', '1.1.0');
    url.searchParams.set('REQUEST', 'GetCapabilities');
    const xml = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000 })).text();

    const dimensions = parseWmsLayerDimensions(xml, LAYER);
    const run = dimensions?.extra.INITD?.default;
    if (!dimensions || !run) return null;
    // El contrato pide el FIN de cada día: inicio publicado + 24 h.
    const dailyTimes = dimensions.times
      .filter((time) => Date.parse(time) >= Date.parse(run))
      .map((start) => new Date(Date.parse(start) + DAY_MS).toISOString());
    return { run, dailyTimes };
  }

  async getNextHoursGrid(hours: number, now: number): Promise<WindowRainGrid | null> {
    const steps = await this.stepRunCache.get('latest', () => this.latestStepRun());
    const ends = steps && nextStepEnds(steps.times, hours, now);
    if (!steps || !ends) return null;
    const grids = await Promise.all(ends.map((end) => this.stepGrid(steps.run, end)));
    return {
      run: steps.run,
      from: new Date(Date.parse(ends[0]) - STEP_MS).toISOString(),
      to: ends[ends.length - 1],
      grid: scaled(sumGrids(grids), STEP_SCALE),
    };
  }

  /** Corrida de la capa de 3 h y sus pasos (los de corridas anteriores no se piden). */
  private async latestStepRun(): Promise<{ run: string; times: string[] } | null> {
    const url = new URL(this.config.get('GEOGLOWS_WRF_WMS_URL'));
    url.searchParams.set('SERVICE', 'WMS');
    url.searchParams.set('VERSION', '1.1.0');
    url.searchParams.set('REQUEST', 'GetCapabilities');
    const xml = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000 })).text();
    const dimensions = parseWmsLayerDimensions(xml, STEP_LAYER);
    const initd = dimensions?.extra.INITD;
    const run = initd?.default ?? [...(initd?.values ?? [])].sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
    if (!dimensions || !run) return null;
    return { run, times: dimensions.times.filter((time) => Date.parse(time) >= Date.parse(run)) };
  }

  private stepGrid(run: string, end: string): Promise<RasterGrid> {
    return this.stepGridCache.get(`${run}|${end}`, async () => {
      const url = new URL(this.config.get('GEOGLOWS_WRF_WCS_URL'));
      url.searchParams.set('service', 'WCS');
      url.searchParams.set('version', '2.0.1');
      url.searchParams.set('request', 'GetCoverage');
      url.searchParams.set('coverageId', STEP_COVERAGE_ID);
      url.searchParams.set('format', 'image/tiff');
      url.searchParams.append('subset', `time("${end}")`);
      url.searchParams.append('subset', `INITD("${run}")`);

      const buffer = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000, retries: 1 })).arrayBuffer();
      try {
        return await readGeoTiffGrid(buffer);
      } catch {
        throw new UpstreamError(SERVICE, `no hay datos de lluvia para el paso que termina ${end}`);
      }
    });
  }

  /** `time` es el fin de las 24 h; el servidor las publica con su inicio. */
  getDailyGrid(run: string, time: string): Promise<RasterGrid> {
    const start = new Date(Date.parse(time) - DAY_MS).toISOString();
    return this.gridCache.get(`${run}|${start}`, async () => {
      const url = new URL(this.config.get('GEOGLOWS_WRF_WCS_URL'));
      url.searchParams.set('service', 'WCS');
      url.searchParams.set('version', '2.0.1');
      url.searchParams.set('request', 'GetCoverage');
      url.searchParams.set('coverageId', COVERAGE_ID);
      url.searchParams.set('format', 'image/tiff');
      url.searchParams.append('subset', `time("${start}")`);
      url.searchParams.append('subset', `INITD("${run}")`);

      const buffer = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000, retries: 1 })).arrayBuffer();
      try {
        return await readGeoTiffGrid(buffer);
      } catch {
        // El servidor responde un XML de error (con HTTP 200) si el paso no existe.
        throw new UpstreamError(SERVICE, `no hay datos de lluvia para el día que empieza ${start}`);
      }
    });
  }

  getColorStops(): Promise<ColorStop[]> {
    return this.stopsCache.get('stops', async () => {
      const url = new URL(this.config.get('GEOGLOWS_WRF_WMS_URL'));
      url.searchParams.set('REQUEST', 'GetLegendGraphic');
      url.searchParams.set('VERSION', '1.1.1');
      url.searchParams.set('FORMAT', 'application/json');
      url.searchParams.set('LAYER', LAYER);
      const data = (await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 30_000 })).json()) as LegendGraphicJson;
      const stops = colorStopsFromLegendGraphic(data);
      if (stops.length === 0) throw new UpstreamError(SERVICE, 'la capa no publica su paleta de colores');
      return stops;
    });
  }
}

/** La grilla multiplicada por un factor (las celdas sin dato quedan igual). */
function scaled(grid: RasterGrid, factor: number): RasterGrid {
  return {
    ...grid,
    values: grid.values.map((value) => (value === grid.noData || !Number.isFinite(value) ? value : value * factor)),
  };
}
