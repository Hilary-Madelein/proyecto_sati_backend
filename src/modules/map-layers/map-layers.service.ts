import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { parseWmsLayerDimensions } from '../../common/wms/wms-capabilities.js';
import { buildWmsUrl, WmsRequestError } from '../../common/wms/wms-request.js';
import {
  MapLayerProvider,
  type MapLayerDefinition,
  type MapLayerProviderAdapter,
  type WmsLayerDefinition,
} from './map-layer.js';

const CAPABILITIES_TTL_MS = 10 * 60 * 1000;
const LEGEND_TTL_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Ventana de pasos de tiempo que se ofrecen al cliente: desde 48 h atrás. */
const TIME_WINDOW_PAST_MS = 48 * HOUR_MS;
/** Si el último paso disponible tiene más de 3 h de antigüedad, el pronóstico está atrasado. */
const STALE_AFTER_HOURS = 3;

export interface LayerAvailability {
  id: string;
  /** Pasos de tiempo ofrecidos (desde 48 h atrás hasta el final de la corrida). */
  times: string[];
  /** Paso más cercano a ahora: el que conviene mostrar por defecto. */
  defaultTime: string | null;
  latestTime: string | null;
  /** Corrida del modelo (dimensión INITD), si la capa la tiene. */
  run: string | null;
  /** Todos los pasos de tiempo desde el inicio de la corrida (vacío si no hay corrida). */
  runTimes: string[];
  isStale: boolean;
  /** Horas desde el último paso disponible (0 si llega al futuro). */
  staleHours: number;
}

export interface LayerLegend {
  id: string;
  unit: string | null;
  /** Rampa de colores real del servidor, de menor a mayor. */
  entries: Array<{ value: number; color: string }>;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
}

@Injectable()
export class MapLayersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MapLayersService.name);
  private readonly layers = new Map<string, MapLayerDefinition>();
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly discovery: DiscoveryService) {}

  /** Registra las capas de todas las integraciones marcadas con @MapLayerProvider(). */
  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders({ metadataKey: MapLayerProvider.KEY })) {
      const provider = wrapper.instance as MapLayerProviderAdapter | undefined;
      for (const layer of provider?.getLayers() ?? []) {
        if (this.layers.has(layer.id)) throw new Error(`Hay dos capas con el id "${layer.id}"`);
        this.layers.set(layer.id, layer);
      }
    }
    this.logger.log(`${this.layers.size} capas de mapa registradas`);
  }

  list(): MapLayerDefinition[] {
    return [...this.layers.values()];
  }

  get(id: string): MapLayerDefinition {
    const layer = this.layers.get(id);
    if (!layer) throw new NotFoundException(`No existe la capa "${id}"`);
    return layer;
  }

  async availability(id: string): Promise<LayerAvailability> {
    const layer = this.getWms(id);
    const xml = await this.cached(`capabilities:${layer.serviceUrl}`, CAPABILITIES_TTL_MS, () =>
      this.fetchText(layer.serviceUrl, { REQUEST: 'GetCapabilities', SERVICE: 'WMS', VERSION: '1.1.0' }),
    );

    const shortName = layer.layerName.split(':').pop() ?? layer.layerName;
    const dimensions = parseWmsLayerDimensions(xml, shortName);
    if (!dimensions) throw new BadGatewayException(`El servidor no publica la capa "${layer.layerName}"`);

    const now = Date.now();
    const allTimes = dimensions.times;
    let times = allTimes.filter((time) => Date.parse(time) >= now - TIME_WINDOW_PAST_MS);
    if (times.length === 0) times = allTimes.slice(-16);

    const run = dimensions.extra.INITD?.default ?? null;
    const runTimes = run ? allTimes.filter((time) => Date.parse(time) > Date.parse(run)) : [];
    const latestTime = allTimes.at(-1) ?? null;
    const staleHours = latestTime ? Math.max(0, (now - Date.parse(latestTime)) / HOUR_MS) : 0;

    return {
      id,
      times,
      defaultTime: closestTo(times, now),
      latestTime,
      run,
      runTimes,
      isStale: staleHours > STALE_AFTER_HOURS,
      staleHours: Math.round(staleHours * 10) / 10,
    };
  }

  async legend(id: string): Promise<LayerLegend> {
    const layer = this.getWms(id);
    return this.cached(`legend:${id}`, LEGEND_TTL_MS, async () => {
      const url = buildWmsUrl(layer, { REQUEST: 'GetLegendGraphic', VERSION: '1.1.1', FORMAT: 'application/json' });
      const response = await fetchWithRetry(url, { service: 'WMS', timeoutMs: 30_000 });
      const data = (await response.json()) as LegendGraphicJson;
      const entries = data.Legend?.[0]?.rules?.[0]?.symbolizers?.[0]?.Raster?.colormap?.entries ?? [];
      return {
        id,
        unit: layer.unit,
        entries: entries
          .filter((entry) => Number.parseFloat(entry.opacity ?? '1') > 0)
          .map((entry) => ({ value: Number.parseFloat(entry.quantity), color: entry.color })),
      };
    });
  }

  /** Reenvía una petición WMS (GetMap, GetFeatureInfo, …) a la capa indicada. */
  async proxy(id: string, query: Record<string, unknown>): Promise<{ body: Buffer; contentType: string; cacheSeconds: number }> {
    const layer = this.getWms(id);
    let url: URL;
    try {
      url = buildWmsUrl(layer, query);
    } catch (error) {
      if (error instanceof WmsRequestError) throw new BadRequestException(error.message);
      throw error;
    }

    try {
      const response = await fetchWithRetry(url, { service: 'WMS', timeoutMs: 30_000, retries: 1 });
      return {
        body: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        cacheSeconds: layer.tileCacheSeconds,
      };
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  /** Reenvía una tesela vectorial (MVT). Devuelve null si la tesela está vacía. */
  async vectorTile(id: string, z: number, x: number, y: number): Promise<{ body: Buffer; cacheSeconds: number } | null> {
    const layer = this.get(id);
    if (layer.kind !== 'vector') throw new BadRequestException(`La capa "${id}" no es de teselas vectoriales`);
    const max = 2 ** z;
    if (z < layer.minZoom || z > layer.maxZoom || x < 0 || y < 0 || x >= max || y >= max) {
      throw new BadRequestException(`Tesela fuera de rango (zoom ${layer.minZoom}–${layer.maxZoom})`);
    }

    const url = layer.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    try {
      const response = await fetchWithRetry(url, { service: 'Teselas', timeoutMs: 20_000, retries: 1 });
      const body = Buffer.from(await response.arrayBuffer());
      return body.length > 0 ? { body, cacheSeconds: layer.tileCacheSeconds } : null;
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  private getWms(id: string): WmsLayerDefinition {
    const layer = this.get(id);
    if (layer.kind !== 'wms') throw new BadRequestException(`La capa "${id}" no es WMS`);
    return layer;
  }

  private async fetchText(serviceUrl: string, params: Record<string, string>): Promise<string> {
    const url = new URL(serviceUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    try {
      return await (await fetchWithRetry(url, { service: 'WMS', timeoutMs: 40_000 })).text();
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  /** Caché en memoria por clave; comparte la misma promesa entre peticiones simultáneas. */
  private cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = load();
    this.cache.set(key, { expiresAt: Date.now() + ttlMs, value });
    value.catch(() => this.cache.delete(key));
    return value;
  }
}

function closestTo(times: string[], target: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const time of times) {
    const distance = Math.abs(Date.parse(time) - target);
    if (distance < bestDistance) [best, bestDistance] = [time, distance];
  }
  return best;
}

interface LegendGraphicJson {
  Legend?: Array<{
    rules?: Array<{
      symbolizers?: Array<{
        Raster?: { colormap?: { entries?: Array<{ quantity: string; color: string; opacity?: string }> } };
      }>;
    }>;
  }>;
}
