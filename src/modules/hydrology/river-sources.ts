import type { RiverAlertsSnapshot, RiverForecast, RiverReturnPeriods } from './domain/river.js';

/**
 * Contratos que implementan las integraciones de hidrología. El dominio solo
 * conoce estas clases: cambiar de proveedor (o sumar otro) no toca la API.
 */
export abstract class RiverForecastSource {
  /** Tramo de río más cercano a un punto, o null si no hay ninguno. */
  abstract findRiverId(latitude: number, longitude: number): Promise<number | null>;
  abstract getForecast(riverId: number): Promise<RiverForecast>;
  /** Caudales de los periodos de retorno (no cambian con cada pronóstico). */
  abstract getReturnPeriods(riverId: number): Promise<RiverReturnPeriods>;
}

export abstract class RiverAlertSource {
  /** Alertas del pronóstico más reciente disponible. */
  abstract getLatestAlerts(): Promise<RiverAlertsSnapshot>;
}
