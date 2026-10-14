export type StationCategory = 'meteorological' | 'hydrological' | 'hydrometeorological';

export interface WeatherStation {
  id: number;
  /** Código oficial, p. ej. "M0003". */
  code: string;
  name: string;
  lat: number;
  lng: number;
  /** Metros sobre el nivel del mar; null si la fuente no lo informa. */
  altitude: number | null;
  category: StationCategory;
  /** Si la estación envía sus datos en tiempo real. */
  transmitting: boolean;
}

/** Lluvia de una hora: la que cayó en la hora que termina en `time` (ISO 8601). */
export interface HourlyRain {
  time: string;
  /** null si la estación no registró ese dato. */
  mm: number | null;
}

/**
 * Contrato de una red de estaciones con lluvia horaria. Hoy la implementa la
 * API del INAMHI; otra red solo tiene que cumplir este contrato.
 */
export abstract class WeatherStationSource {
  abstract readonly attribution: string;
  /** Horas que devuelve `getRecentHourlyRain` (la fuente no guarda más). */
  abstract readonly windowHours: number;
  abstract getStations(): Promise<WeatherStation[]>;
  /** Lluvia de cada hora de la ventana reciente, de la más antigua a la más reciente. */
  abstract getRecentHourlyRain(stationId: number): Promise<HourlyRain[]>;
}
