/** Periodos de retorno (años) usados para clasificar caudales altos. */
export const RETURN_PERIODS = [2, 5, 10, 25, 50, 100] as const;

/** Nivel de alerta: 0 = normal; si no, el mayor periodo de retorno superado. */
export type AlertLevel = 0 | (typeof RETURN_PERIODS)[number];

export interface RiverAlert {
  /** Identificador del tramo de río (TDX-Hydro / GEOGLOWS, 9 dígitos). */
  riverId: number;
  latitude: number;
  longitude: number;
  /** Orden de Strahler: más alto = río más grande. */
  streamOrder: number | null;
  province: string | null;
  canton: string | null;
  river: string | null;
  /** Nivel de alerta por día del pronóstico (índice 0 = primer día). */
  dailyLevels: AlertLevel[];
  /** Mayor nivel en todo el horizonte. */
  maxLevel: AlertLevel;
}

export interface RiverAlertsSnapshot {
  /** Fuente de las alertas, p. ej. "INAMHI · GEOGLOWS". */
  source: string;
  /** Fecha de inicio del pronóstico (AAAA-MM-DD). */
  forecastDate: string;
  /** Fecha de cada día del pronóstico (AAAA-MM-DD), alineada con `dailyLevels`. */
  days: string[];
  /** Tramos evaluados en total (con o sin alerta). */
  totalReaches: number;
  /** Solo los tramos con alguna alerta en el horizonte. */
  alerts: RiverAlert[];
}

/** Serie de caudal pronosticado (m³/s). Los valores faltantes son null. */
export interface RiverForecast {
  riverId: number;
  source: string;
  /** Fecha ISO 8601 en que se generó el pronóstico. */
  generatedAt: string | null;
  unit: 'm3/s';
  times: string[];
  /** Pronóstico determinístico de alta resolución. */
  highRes: Array<number | null>;
  /** Estadísticas del ensamble. */
  ensemble: {
    min: Array<number | null>;
    p25: Array<number | null>;
    median: Array<number | null>;
    mean: Array<number | null>;
    p75: Array<number | null>;
    max: Array<number | null>;
  };
  /**
   * Condiciones antecedentes: caudal con que arrancó el pronóstico de cada uno
   * de los días anteriores. null si la fuente no las pudo dar.
   */
  antecedent: { times: string[]; flow: Array<number | null> } | null;
  /**
   * AAAAMMDD de una corrida anterior cuando la más reciente no se pudo leer
   * (GEOGLOWS a veces publica la del día incompleta); null si es la vigente.
   */
  fallbackRun: string | null;
}

/** Caudales de los periodos de retorno de un tramo (umbrales de las alertas). */
export interface RiverReturnPeriods {
  riverId: number;
  /** Cómo se calcularon, para mostrarlo junto al gráfico. */
  method: string;
  /** De menor a mayor periodo. */
  thresholds: Array<{ years: number; flow: number }>;
}

/** Una corrida de pronóstico emitida (siempre a las 00 UTC) y dónde se consulta. */
export interface ForecastRun {
  /** AAAAMMDD. */
  date: string;
  /** `api`: API REST de GEOGLOWS (últimas semanas, rápida). `archive`: archivo Zarr en AWS (desde julio de 2024, lento). */
  origin: 'api' | 'archive';
}

/** Corridas disponibles, de la más reciente a la más antigua. */
export interface ForecastRunsCatalog {
  runs: ForecastRun[];
  api: { from: string; to: string } | null;
  archive: { from: string; to: string } | null;
}

/** Pronóstico de una corrida pasada: lo que se pronosticaba ese día (sin antecedentes). */
export interface ArchivedRiverForecast extends Omit<RiverForecast, 'antecedent' | 'fallbackRun'> {
  /** AAAAMMDD de la corrida. */
  run: string;
  origin: ForecastRun['origin'];
}

/** Todos los miembros de una corrida: 51 del ensamble y el 52 = alta resolución. */
export interface RiverForecastMembers {
  riverId: number;
  run: string;
  origin: ForecastRun['origin'];
  unit: 'm3/s';
  times: string[];
  members: Array<{ member: number; highRes: boolean; flow: Array<number | null> }>;
}
