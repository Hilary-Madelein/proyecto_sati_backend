import { DiscoveryService } from '@nestjs/core';

export type MapLayerCategory = 'rain' | 'hydrology' | 'risk' | 'other';

interface BaseLayerDefinition {
  /** Identificador público y estable, p. ej. "wrf-precipitation". */
  id: string;
  title: string;
  description: string;
  category: MapLayerCategory;
  attribution: string;
  /** Segundos que se pueden cachear las teselas. */
  tileCacheSeconds: number;
}

/** Capa WMS que el backend publica (y a la que hace de proxy). */
export interface WmsLayerDefinition extends BaseLayerDefinition {
  kind: 'wms';
  /** Unidad de los valores (para la leyenda y la consulta por punto), p. ej. "mm". */
  unit: string | null;
  serviceUrl: string;
  /** Nombre de la capa en el servidor, p. ej. "wrf:wrf_precipitation". */
  layerName: string;
  /** Dimensiones extra que acepta además de TIME, p. ej. ["DIM_INITD"]. */
  extraParams: string[];
}

/** Teselas vectoriales (Mapbox Vector Tiles) servidas en /{z}/{x}/{y}. */
export interface VectorTileLayerDefinition extends BaseLayerDefinition {
  kind: 'vector';
  /** Plantilla de la fuente con {z}, {x} y {y}. */
  tileUrl: string;
  /** Nombre de la capa dentro de cada tesela. */
  sourceLayer: string;
  minZoom: number;
  maxZoom: number;
}

export type MapLayerDefinition = WmsLayerDefinition | VectorTileLayerDefinition;

/** Contrato de una integración que publica capas de mapa. */
export interface MapLayerProviderAdapter {
  getLayers(): MapLayerDefinition[];
}

/**
 * Marca un provider que aporta capas de mapa. El módulo de capas los descubre
 * al arrancar, así una API nueva solo tiene que declarar sus capas.
 */
export const MapLayerProvider = DiscoveryService.createDecorator<void>();
