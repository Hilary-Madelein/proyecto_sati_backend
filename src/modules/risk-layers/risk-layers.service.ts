import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { fetchArcgisLayer, type GeoJsonFeature } from '../../integrations/arcgis/arcgis-feature-layer.js';
import type { RiskLayerDefinition, RiskLayerSummary } from './risk-layer.js';
import { RISK_LAYERS } from './risk-layers.catalog.js';

const MINUTE_MS = 60 * 1000;
/** Carpeta de los GeoJSON propios, relativa a la raíz del proyecto (donde se ejecuta el servidor). */
const FILES_DIR = join(process.cwd(), 'assets', 'risk-layers');
/** Ecuador con Galápagos: las entidades fuera de este recuadro tienen coordenadas mal cargadas. */
const ECUADOR_BOX = { minLng: -92.5, maxLng: -75, minLat: -6, maxLat: 2.5 };

export interface RiskLayerData {
  id: string;
  title: string;
  attribution: string;
  /** Cuándo se descargó del servicio o se leyó el archivo (ISO 8601). */
  fetchedAt: string;
  /** Última edición en el servicio de origen, si la informa. */
  sourceUpdatedAt: string | null;
  /** True si el servicio falló y se entrega la última descarga buena. */
  isStale: boolean;
  /** Entidades del origen que no se entregan por no tener ubicación o tenerla fuera del Ecuador. */
  omitted: number;
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

interface Entry {
  data: RiskLayerData;
  expiresAt: number;
}

/**
 * Capas de amenaza, exposición, preparación y respuesta. Cada una se descarga
 * recién cuando alguien la pide y se guarda en memoria; si el servicio de origen
 * falla, se sigue entregando la última descarga buena.
 */
@Injectable()
export class RiskLayersService {
  private readonly logger = new Logger(RiskLayersService.name);
  private readonly layers = new Map(RISK_LAYERS.map((layer) => [layer.id, layer]));
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<RiskLayerData>>();

  list(): RiskLayerSummary[] {
    return RISK_LAYERS.map(({ id, title, component, attribution, source }) => ({
      id,
      title,
      component,
      attribution,
      sourceKind: source.kind,
    }));
  }

  async get(id: string): Promise<RiskLayerData> {
    const layer = this.layers.get(id);
    if (!layer) throw new NotFoundException(`No existe la capa "${id}"`);

    const entry = this.entries.get(id);
    if (entry && entry.expiresAt > Date.now()) return entry.data;
    try {
      return await this.load(layer);
    } catch (error) {
      if (entry) {
        this.logger.warn(`Capa "${id}": se entrega la descarga anterior (${(error as Error).message})`);
        return { ...entry.data, isStale: true };
      }
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  /** Una sola descarga por capa a la vez: los pedidos simultáneos esperan la misma. */
  private load(layer: RiskLayerDefinition): Promise<RiskLayerData> {
    let pending = this.loading.get(layer.id);
    if (!pending) {
      pending = this.fetch(layer)
        .then((data) => {
          const ttl = layer.source.kind === 'arcgis' ? layer.source.refreshMinutes * MINUTE_MS : Infinity;
          this.entries.set(layer.id, { data, expiresAt: Date.now() + ttl });
          return data;
        })
        .finally(() => this.loading.delete(layer.id));
      this.loading.set(layer.id, pending);
    }
    return pending;
  }

  private async fetch(layer: RiskLayerDefinition): Promise<RiskLayerData> {
    const base = { id: layer.id, title: layer.title, attribution: layer.attribution, isStale: false, type: 'FeatureCollection' as const };
    const fetchedAt = new Date().toISOString();

    if (layer.source.kind === 'file') {
      const json = JSON.parse(await readFile(join(FILES_DIR, layer.source.file), 'utf8')) as { features: GeoJsonFeature[] };
      return { ...base, fetchedAt, sourceUpdatedAt: null, ...located(json.features) };
    }

    const started = Date.now();
    const { features, lastEditDate } = await fetchArcgisLayer(layer.source.layerUrl, layer.source);
    this.logger.log(`Capa "${layer.id}": ${features.length} entidades en ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return { ...base, fetchedAt, sourceUpdatedAt: lastEditDate, ...located(features) };
  }
}

/** Separa las entidades con ubicación válida de las que no la tienen (sin geometría o fuera del Ecuador). */
export function located(features: GeoJsonFeature[]): { features: GeoJsonFeature[]; omitted: number } {
  const valid = features.filter((feature) => {
    const first = firstPosition(feature.geometry?.coordinates);
    if (!first) return false;
    const [lng, lat] = first;
    return lng >= ECUADOR_BOX.minLng && lng <= ECUADOR_BOX.maxLng && lat >= ECUADOR_BOX.minLat && lat <= ECUADOR_BOX.maxLat;
  });
  return { features: valid, omitted: features.length - valid.length };
}

function firstPosition(coordinates: unknown): [number, number] | null {
  let current = coordinates;
  while (Array.isArray(current) && Array.isArray(current[0])) current = current[0];
  return Array.isArray(current) && typeof current[0] === 'number' && typeof current[1] === 'number'
    ? [current[0], current[1]]
    : null;
}
