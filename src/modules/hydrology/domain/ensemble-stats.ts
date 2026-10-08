import type { RiverForecast } from './river.js';

/** Miembros del ensamble ECMWF que entran en las estadísticas; el 52 es el pronóstico de alta resolución. */
export const ENSEMBLE_MEMBERS = 51;

/** Percentil con interpolación lineal entre posiciones (como numpy, que usa GEOGLOWS). */
function percentile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Estadísticas por paso de tiempo a partir de los 52 miembros, igual que
 * `forecaststats` de GEOGLOWS: mín., 25 %, mediana, promedio, 75 % y máx. de
 * los miembros 1–51, y el 52 como alta resolución. Un paso sin ningún miembro
 * con dato queda en null (el ensamble va cada 3 h; la alta resolución, cada 1 h).
 */
export function ensembleStats(members: ReadonlyArray<ReadonlyArray<number | null>>): Pick<RiverForecast, 'highRes' | 'ensemble'> {
  const steps = members[0]?.length ?? 0;
  const ensemble: RiverForecast['ensemble'] = { min: [], p25: [], median: [], mean: [], p75: [], max: [] };
  const highRes: Array<number | null> = [];

  for (let step = 0; step < steps; step++) {
    const values = members
      .slice(0, ENSEMBLE_MEMBERS)
      .map((member) => member[step])
      .filter((value): value is number => value !== null && Number.isFinite(value))
      .sort((a, b) => a - b);
    const stat = (value: () => number) => (values.length > 0 ? round(value()) : null);
    ensemble.min.push(stat(() => values[0]));
    ensemble.p25.push(stat(() => percentile(values, 0.25)));
    ensemble.median.push(stat(() => percentile(values, 0.5)));
    ensemble.mean.push(stat(() => values.reduce((sum, value) => sum + value, 0) / values.length));
    ensemble.p75.push(stat(() => percentile(values, 0.75)));
    ensemble.max.push(stat(() => values.at(-1)!));
    const high = members[ENSEMBLE_MEMBERS]?.[step];
    highRes.push(high !== null && high !== undefined && Number.isFinite(high) ? round(high) : null);
  }
  return { highRes, ensemble };
}

/** "2026-10-01", "20261001" o "2026100100" → "20261001"; null si no es una fecha válida. */
export function normalizeRunDate(input: string): string | null {
  const digits = input.replaceAll('-', '');
  if (!/^\d{8}(00)?$/.test(digits)) return null;
  const date = digits.slice(0, 8);
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10).replaceAll('-', '') !== date ? null : date;
}
