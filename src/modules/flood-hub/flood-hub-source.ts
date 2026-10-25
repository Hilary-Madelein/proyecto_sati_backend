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

/**
 * Contrato de la fuente de Flood Hub. Hoy la implementa el GeoJSON del demo
 * GDE-Niño; con una clave de la API de Google, otra clase la reemplaza sin
 * cambiar el resto.
 */
export abstract class FloodHubSource {
  abstract readonly attribution: string;
  abstract getGauges(): Promise<FloodHubGauge[]>;
}
