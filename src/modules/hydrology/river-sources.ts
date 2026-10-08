import type {
  ArchivedRiverForecast,
  ForecastRun,
  ForecastRunsCatalog,
  RiverAlertsSnapshot,
  RiverForecast,
  RiverForecastMembers,
  RiverReturnPeriods,
} from './domain/river.js';

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

/** Pronósticos ya emitidos (corridas pasadas), para consultarlos o compararlos. */
export abstract class RiverForecastArchive {
  /** Corridas disponibles, de la más reciente a la más antigua. */
  abstract listRuns(): Promise<ForecastRunsCatalog>;
  /** Estadísticas del ensamble de una corrida para un tramo. */
  abstract getRunForecast(riverId: number, run: ForecastRun): Promise<ArchivedRiverForecast>;
  /** Los 52 miembros de una corrida para un tramo. */
  abstract getRunMembers(riverId: number, run: ForecastRun): Promise<RiverForecastMembers>;
}
