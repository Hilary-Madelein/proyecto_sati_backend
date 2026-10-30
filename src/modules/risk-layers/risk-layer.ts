import type { GeoJsonFeature } from '../../integrations/arcgis/arcgis-feature-layer.js';

/** Componente de la gestión del riesgo al que pertenece una capa (las pestañas del frontend). */
export type RiskComponent = 'amenaza' | 'exposicion' | 'preparacion' | 'respuesta';

/** Capa de un FeatureServer de ArcGIS, que se consulta y se guarda en caché. */
export interface ArcgisRiskLayerSource {
  kind: 'arcgis';
  /** URL de la capa, terminada en el número de capa (…/FeatureServer/0). */
  layerUrl: string;
  /** Campos que se entregan. Los datos personales (operadores, encuestadores, chasis…) quedan fuera. */
  fields: readonly string[];
  /** Tolerancia de simplificación en grados para líneas y polígonos (~0,0005 = 55 m). */
  maxAllowableOffset?: number;
  /** Entregar los campos con dominio con su nombre en vez del código. */
  decodeDomains?: boolean;
  /**
   * Cada cuánto se vuelve a descargar si el servicio no informa la fecha de su
   * última edición. Si la informa (lo normal en ArcGIS Online), se descarga cada
   * vez que cambia, sin esperar este plazo.
   */
  refreshMinutes: number;
}

/** GeoJSON propio, en assets/risk-layers (capas que no tienen servicio). */
export interface FileRiskLayerSource {
  kind: 'file';
  /** Nombre del archivo dentro de assets/risk-layers. */
  file: string;
}

export interface RiskLayerDefinition {
  /** Identificador público y estable, p. ej. "rve". */
  id: string;
  title: string;
  component: RiskComponent;
  attribution: string;
  source: ArcgisRiskLayerSource | FileRiskLayerSource;
  /** Campos que calcula el backend sobre las entidades descargadas (p. ej. si una obra cuenta en el índice de preparación). */
  annotate?: (features: GeoJsonFeature[]) => GeoJsonFeature[];
  /**
   * Agrega a cada punto `Via_RVE`, el código de su vía: el que declara la propia
   * capa en `declaredField` (p. ej. "E 487" → "E487"), o si no lo trae, el de la
   * vía de la RVE más cercana a menos de 1 km (null si no hay).
   */
  nearestRoad?: {
    declaredField?: string;
    /** Campo "¿está en la RVE?": si dice "No", el punto no lleva vía (no se busca la más cercana). */
    onRoadField?: string;
  };
}

export interface RiskLayerSummary {
  id: string;
  title: string;
  component: RiskComponent;
  attribution: string;
  /** "arcgis": servicio en línea; "file": archivo entregado al proyecto. */
  sourceKind: 'arcgis' | 'file';
}
