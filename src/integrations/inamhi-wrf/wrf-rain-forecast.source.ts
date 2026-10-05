import { Injectable } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { ColorStop } from '../../common/raster/color-ramp.js';
import { readGeoTiffGrid } from '../../common/raster/geotiff.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { colorStopsFromLegendGraphic, type LegendGraphicJson } from '../../common/wms/legend-graphic.js';
import { parseWmsLayerDimensions } from '../../common/wms/wms-capabilities.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { RainForecastSource, type ForecastRun } from '../../modules/rain-forecast/rain-forecast-source.js';

const SERVICE = 'WRF INAMHI';
/** Capa de lluvia diaria: cada paso es la lluvia de las 24 h que terminan en él. */
const LAYER = 'wrf_precipitation_daily';
const COVERAGE_ID = `wrf__${LAYER}`;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Lluvia diaria del modelo WRF del INAMHI (GeoServer servido por GeoGLOWS):
 * corridas por el GetCapabilities WMS, valores por WCS (GeoTIFF) y paleta por
 * GetLegendGraphic, para que el acumulado se vea igual que las capas oficiales.
 */
@Injectable()
export class WrfRainForecastSource extends RainForecastSource {
  readonly attribution = 'Lluvia pronosticada: INAMHI · modelo WRF';
  // Una grilla de una corrida no cambia: se guarda varias horas.
  private readonly gridCache = new TtlCache<RasterGrid>(6 * HOUR_MS, 12);
  private readonly stopsCache = new TtlCache<ColorStop[]>(24 * HOUR_MS, 1);

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
    return { run, dailyTimes: dimensions.times.filter((time) => Date.parse(time) > Date.parse(run)) };
  }

  getDailyGrid(run: string, time: string): Promise<RasterGrid> {
    return this.gridCache.get(`${run}|${time}`, async () => {
      const url = new URL(this.config.get('GEOGLOWS_WRF_WCS_URL'));
      url.searchParams.set('service', 'WCS');
      url.searchParams.set('version', '2.0.1');
      url.searchParams.set('request', 'GetCoverage');
      url.searchParams.set('coverageId', COVERAGE_ID);
      url.searchParams.set('format', 'image/tiff');
      url.searchParams.append('subset', `time("${time}")`);
      url.searchParams.append('subset', `INITD("${run}")`);

      const buffer = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000, retries: 1 })).arrayBuffer();
      try {
        return await readGeoTiffGrid(buffer);
      } catch {
        // El servidor responde un XML de error (con HTTP 200) si el paso no existe.
        throw new UpstreamError(SERVICE, `no hay datos de lluvia para ${time}`);
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
