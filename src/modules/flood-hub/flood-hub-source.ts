/** Nivel de inundación que pronostica Flood Hub en un punto (de menor a mayor). */
export type FloodHubSeverity = 'unknown' | 'no_flooding' | 'above_normal' | 'severe' | 'extreme';

/** Hacia dónde va el caudal pronosticado. */
export type FloodHubTrend = 'rise' | 'fall' | 'no_change' | 'unknown';

/** Punto de pronóstico de Flood Hub (una cuenca HydroBASINS) con su último estado. */
export interface FloodHubGauge {
  /** Id de Flood Hub, p. ej. "hybas_6120032320". */
  id: string;
  lat: number;
  lng: number;
  severity: FloodHubSeverity;
  trend: FloodHubTrend;
  /** Google verificó la calidad del modelo en este punto. */
  verified: boolean;
  /** Cuándo emitió Google este pronóstico (ISO 8601). */
  issuedAt: string | null;
  /** Ventana del pronóstico a la que se refiere el nivel (ISO 8601). */
  forecastFrom: string | null;
  forecastTo: string | null;
}

export type FlashFloodLikelihood = 'likely' | 'highly_likely';

export interface FlashFloodGeometry {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

/** Zona urbana con riesgo de crecida repentina (celdas de ~20 km) y su nivel de probabilidad. */
export interface FlashFloodArea {
  /** Id del polígono en Google. */
  id: string;
  likelihood: FlashFloodLikelihood;
  issuedAt: string;
  /** Fin de la validez del pronóstico (ISO 8601). */
  validUntil: string;
  /** Países afectados (ISO 3166 alfa-2); puede incluir vecinos del Ecuador. */
  countries: string[];
  geometry: FlashFloodGeometry;
}

/**
 * Contrato de la fuente de Flood Hub: la API de Google si hay clave; si no, el
 * GeoJSON del demo GDE-Niño.
 */
export abstract class FloodHubSource {
  abstract readonly attribution: string;
  abstract getGauges(): Promise<FloodHubGauge[]>;
  /** Crecidas repentinas vigentes; null si la fuente no las ofrece. */
  abstract getFlashFloods(): Promise<FlashFloodArea[] | null>;
}
