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
}
