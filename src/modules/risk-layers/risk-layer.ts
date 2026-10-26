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
  /** Cada cuánto se vuelve a consultar el servicio. */
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
}

export interface RiskLayerSummary {
  id: string;
  title: string;
  component: RiskComponent;
  attribution: string;
  /** "arcgis": servicio en línea; "file": archivo entregado al proyecto. */
  sourceKind: 'arcgis' | 'file';
}
