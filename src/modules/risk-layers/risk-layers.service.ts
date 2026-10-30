import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UpstreamError } from '../../common/http/upstream.error.js';
import {
  fetchArcgisAttachments,
  fetchArcgisLayer,
  fetchArcgisVersion,
  type ArcgisAttachment,
  type GeoJsonFeature,
} from '../../integrations/arcgis/arcgis-feature-layer.js';
import type { RiskLayerDefinition, RiskLayerSummary } from './risk-layer.js';
import { RISK_LAYERS } from './risk-layers.catalog.js';
import { nearestRoadFinder, roadCodeOf } from './nearest-road.js';

const MINUTE_MS = 60 * 1000;
/** Cada cuánto se pregunta al servicio si la capa cambió (como mucho; solo cuando alguien la pide). */
const CHECK_MS = MINUTE_MS;
/** Red Vial Estatal y su campo con el código de la vía, para la vía más cercana a los puntos. */
const RVE_LAYER_ID = 'rve';
const RVE_CODE_FIELD = 'CODIGO_DE_VIA';
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
  /** Las entidades pueden tener fotos (GET /risk-layers/:id/features/:objectId/attachments). */
  hasAttachments: boolean;
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

interface Entry {
  data: RiskLayerData;
  /** Versión de la capa en el servicio cuando se descargó; null si no la informa. */
  version: number | null;
  /** Cuándo se descargó y cuándo se comprobó por última vez que sigue igual (ms). */
  loadedAt: number;
  checkedAt: number;
}

/**
 * Capas de amenaza, exposición, preparación y respuesta. Cada una se descarga
 * recién cuando alguien la pide y se guarda en memoria. Mientras se siga
 * pidiendo, cada CHECK_MS se pregunta al servicio la versión de la capa (la
 * fecha de su última edición) y se vuelve a descargar solo si cambió: un estado
 * editado en ArcGIS se ve en uno o dos minutos. Si el servicio no informa la
 * versión, se vuelve a descargar cada `refreshMinutes`. Si el servicio de origen
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
    if (entry && Date.now() - entry.checkedAt < CHECK_MS) return entry.data;
    try {
      return await this.refresh(layer, entry);
    } catch (error) {
      if (entry) {
        this.logger.warn(`Capa "${id}": se entrega la descarga anterior (${(error as Error).message})`);
        return { ...entry.data, isStale: true };
      }
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  /** Fotos de una entidad de una capa de ArcGIS, por su id (el de la entidad en GET /risk-layers/:id). */
  async attachments(id: string, objectId: number): Promise<ArcgisAttachment[]> {
    const layer = this.layers.get(id);
    if (!layer) throw new NotFoundException(`No existe la capa "${id}"`);
    if (layer.source.kind !== 'arcgis') return [];
    try {
      return await fetchArcgisAttachments(layer.source.layerUrl, objectId);
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  /** Una sola actualización por capa a la vez: los pedidos simultáneos esperan la misma. */
  private refresh(layer: RiskLayerDefinition, entry: Entry | undefined): Promise<RiskLayerData> {
    let pending = this.loading.get(layer.id);
    if (!pending) {
      pending = this.update(layer, entry).finally(() => this.loading.delete(layer.id));
      this.loading.set(layer.id, pending);
    }
    return pending;
  }

  /** La capa guardada si sigue igual en el servicio; si cambió (o no se puede saber y ya venció), la descarga de nuevo. */
  private async update(layer: RiskLayerDefinition, entry: Entry | undefined): Promise<RiskLayerData> {
    if (entry && (await this.unchanged(layer, entry))) {
      entry.checkedAt = Date.now();
      return entry.data;
    }
    const { data, version } = await this.fetch(layer);
    const now = Date.now();
    this.entries.set(layer.id, { data, version, loadedAt: now, checkedAt: now });
    return data;
  }

  private async unchanged(layer: RiskLayerDefinition, entry: Entry): Promise<boolean> {
    // Los archivos propios solo cambian con un nuevo despliegue.
    if (layer.source.kind === 'file') return true;
    if (entry.version === null) return Date.now() - entry.loadedAt < layer.source.refreshMinutes * MINUTE_MS;
    return (await fetchArcgisVersion(layer.source.layerUrl)) === entry.version;
  }

  private async fetch(layer: RiskLayerDefinition): Promise<{ data: RiskLayerData; version: number | null }> {
    const base = { id: layer.id, title: layer.title, attribution: layer.attribution, isStale: false, type: 'FeatureCollection' as const };
    const fetchedAt = new Date().toISOString();

    if (layer.source.kind === 'file') {
      const json = JSON.parse(await readFile(join(FILES_DIR, layer.source.file), 'utf8')) as { features: GeoJsonFeature[] };
      return { data: { ...base, fetchedAt, sourceUpdatedAt: null, hasAttachments: false, ...located(json.features) }, version: null };
    }

    const started = Date.now();
    const { features, lastEditDate, version, hasAttachments } = await fetchArcgisLayer(layer.source.layerUrl, layer.source);
    this.logger.log(`Capa "${layer.id}": ${features.length} entidades en ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const annotated = layer.annotate ? layer.annotate(features) : features;
    const data = { ...base, fetchedAt, sourceUpdatedAt: lastEditDate, hasAttachments, ...located(await this.withNearestRoad(layer, annotated)) };
    return { data, version };
  }

  /**
   * Código de la vía de cada punto: el que declara la capa o, si no lo trae, el de
   * la vía de la RVE más cercana. Si la RVE no se puede cargar, solo el declarado.
   */
  private async withNearestRoad(layer: RiskLayerDefinition, features: GeoJsonFeature[]): Promise<GeoJsonFeature[]> {
    if (!layer.nearestRoad) return features;
    const { declaredField, onRoadField } = layer.nearestRoad;
    const roads = await this.get(RVE_LAYER_ID).catch((error: unknown) => {
      this.logger.warn(`Capa "${layer.id}": sin vía más cercana (${(error as Error).message})`);
      return null;
    });
    const nearest = roads ? nearestRoadFinder(roads.features, RVE_CODE_FIELD) : null;
    return features.map((feature) => {
      const declared = declaredField ? roadCodeOf(feature.properties[declaredField]) : null;
      if (!declared && onRoadField && String(feature.properties[onRoadField] ?? '').trim().toUpperCase() === 'NO') {
        return { ...feature, properties: { ...feature.properties, Via_RVE: null } };
      }
      const point = feature.geometry?.type === 'Point' ? firstPosition(feature.geometry.coordinates) : null;
      const code = declared ?? (point && nearest ? nearest(point[0], point[1]) : null);
      return { ...feature, properties: { ...feature.properties, Via_RVE: code } };
    });
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
