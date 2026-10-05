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
import { ObservedRainSource, type ObservedRainProduct } from '../../modules/observed-rain/observed-rain-source.js';

const SERVICE = 'Satélite INAMHI';
const WORKSPACE = 'satellite_based_precipitation';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Recuadro descargado (Ecuador continental, igual que el pronóstico WRF), en
 * grados: [oeste, sur, este, norte]. Recortar reduce cada hora de ~590 KB a ~57 KB.
 */
const ECUADOR_BBOX = [-81.2, -5.1, -75.1, 1.6] as const;

interface SatelliteProduct extends ObservedRainProduct {
  /** Capa con la lluvia de cada hora (mm, enteros). */
  hourlyLayer: string;
  /** Capa cuya paleta oficial se usa para pintar el acumulado. */
  legendLayer: string;
}

/**
 * PERSIANN-PDIR-Now: llega casi en tiempo real. IMERG (NASA) no se ofrece: el
 * INAMHI dejó de publicarlo el 3 de marzo de 2026. Si vuelve, basta agregarlo
 * aquí (capas `imerg_early_run_hourly` / `imerg_early_run_24h`).
 */
const PRODUCTS: readonly SatelliteProduct[] = [
  {
    key: 'persiann',
    name: 'PERSIANN',
    attribution: 'Lluvia observada: CHRS PERSIANN-PDIR-Now · INAMHI',
    hourlyLayer: 'persiann_pdir_hourly',
    legendLayer: 'persiann_pdir_24h',
  },
];

/**
 * Lluvia horaria por satélite del GeoServer del INAMHI (servido por GeoGLOWS):
 * horas disponibles por el GetCapabilities WMS, valores por WCS (GeoTIFF
 * recortado a Ecuador) y paleta por GetLegendGraphic.
 */
@Injectable()
export class SatelliteObservedRainSource extends ObservedRainSource {
  readonly products: readonly ObservedRainProduct[] = PRODUCTS.map(({ key, name, attribution }) => ({
    key,
    name,
    attribution,
  }));

  // El GetCapabilities pesa ~1 MB y trae todos los productos: se lee una vez cada 5 min.
  private readonly timesCache = new TtlCache<Record<string, string[]>>(5 * MINUTE_MS, 1);
  // Una hora ya publicada no cambia: se guarda los 3 días que puede necesitar la ventana de 72 h.
  private readonly gridCache = new TtlCache<RasterGrid>(80 * HOUR_MS, 2 * 80);
  private readonly stopsCache = new TtlCache<ColorStop[]>(24 * HOUR_MS, PRODUCTS.length);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getHourlyTimes(productKey: string): Promise<string[]> {
    const product = this.product(productKey);
    const all = await this.timesCache.get('all', async () => {
      const url = new URL(this.config.get('SATELLITE_PRECIPITATION_WMS_URL'));
      url.searchParams.set('SERVICE', 'WMS');
      url.searchParams.set('VERSION', '1.3.0');
      url.searchParams.set('REQUEST', 'GetCapabilities');
      const xml = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000 })).text();
      return Object.fromEntries(
        PRODUCTS.map((candidate) => [
          candidate.key,
          parseWmsLayerDimensions(xml, candidate.hourlyLayer)?.times.map((time) => new Date(time).toISOString()) ?? [],
        ]),
      );
    });
    return all[product.key] ?? [];
  }

  getHourlyGrid(productKey: string, time: string): Promise<RasterGrid> {
    const product = this.product(productKey);
    return this.gridCache.get(`${product.key}|${time}`, async () => {
      const [west, south, east, north] = ECUADOR_BBOX;
      const url = new URL(this.config.get('SATELLITE_PRECIPITATION_WCS_URL'));
      url.searchParams.set('service', 'WCS');
      url.searchParams.set('version', '2.0.1');
      url.searchParams.set('request', 'GetCoverage');
      url.searchParams.set('coverageId', `${WORKSPACE}__${product.hourlyLayer}`);
      url.searchParams.set('format', 'image/tiff');
      url.searchParams.append('subset', `time("${time}")`);
      url.searchParams.append('subset', `Lat(${south},${north})`);
      url.searchParams.append('subset', `Long(${west},${east})`);

      const buffer = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000, retries: 1 })).arrayBuffer();
      try {
        return await readGeoTiffGrid(buffer);
      } catch {
        throw new UpstreamError(SERVICE, `no hay datos de ${product.name} para ${time}`);
      }
    });
  }

  getColorStops(productKey: string): Promise<ColorStop[]> {
    const product = this.product(productKey);
    return this.stopsCache.get(product.key, async () => {
      const url = new URL(this.config.get('SATELLITE_PRECIPITATION_WMS_URL'));
      url.searchParams.set('REQUEST', 'GetLegendGraphic');
      url.searchParams.set('VERSION', '1.1.1');
      url.searchParams.set('FORMAT', 'application/json');
      url.searchParams.set('LAYER', product.legendLayer);
      const data = (await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 30_000 })).json()) as LegendGraphicJson;
      const stops = colorStopsFromLegendGraphic(data);
      if (stops.length === 0) throw new UpstreamError(SERVICE, `${product.name} no publica su paleta de colores`);
      return stops;
    });
  }

  private product(key: string): SatelliteProduct {
    const product = PRODUCTS.find((candidate) => candidate.key === key);
    if (!product) throw new UpstreamError(SERVICE, `producto desconocido "${key}"`);
    return product;
  }
}
