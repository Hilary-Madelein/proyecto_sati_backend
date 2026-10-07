/** Periodos de retorno que se informan, en años (los mismos niveles de las alertas). */
export const RETURN_PERIOD_YEARS = [2, 5, 10, 25, 50, 100] as const;

/** Constante de Euler-Mascheroni, para la distribución de Gumbel. */
const EULER_GAMMA = 0.5772;

/** Caudal máximo de cada año de una serie diaria, desde `fromYear` (incluye el año en curso). */
export function annualMaxima(times: readonly string[], values: readonly (number | null)[], fromYear: number): number[] {
  const byYear = new Map<number, number>();
  times.forEach((time, index) => {
    const year = Number(time.slice(0, 4));
    const value = values[index];
    if (year < fromYear || value === null || !Number.isFinite(value)) return;
    byYear.set(year, Math.max(byYear.get(year) ?? Number.NEGATIVE_INFINITY, value));
  });
  return [...byYear.values()];
}

/**
 * Caudal de cada periodo de retorno con la distribución de Gumbel ajustada por
 * momentos a los máximos anuales: Q(T) = media + K(T) · desviación, con
 * K(T) = −(√6/π)·(γ + ln(ln(T/(T−1)))). Es el método del Hydroviewer del
 * INAMHI (máximos anuales de la simulación histórica de GEOGLOWS desde 1980).
 */
export function gumbelReturnPeriods(maxima: readonly number[], years: readonly number[] = RETURN_PERIOD_YEARS) {
  if (maxima.length < 2) return [];
  const mean = maxima.reduce((sum, value) => sum + value, 0) / maxima.length;
  const variance = maxima.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (maxima.length - 1);
  const deviation = Math.sqrt(variance);
  return years.map((period) => {
    const k = -(Math.sqrt(6) / Math.PI) * (EULER_GAMMA + Math.log(Math.log(period / (period - 1))));
    return { years: period, flow: Math.round((mean + k * deviation) * 10) / 10 };
  });
}

/**
 * Condiciones antecedentes: el caudal con que arrancó cada pronóstico de los
 * últimos `days` días (el valor a las 00:00 UTC del registro de pronósticos),
 * hasta el inicio del pronóstico vigente. Así lo muestra el Hydroviewer del INAMHI.
 */
export function antecedentConditions(
  times: readonly string[],
  values: readonly (number | null)[],
  until: string,
  days: number,
): { times: string[]; flow: Array<number | null> } {
  const end = Date.parse(until);
  const start = end - days * 24 * 60 * 60 * 1000;
  const result = { times: [] as string[], flow: [] as Array<number | null> };
  times.forEach((time, index) => {
    const at = Date.parse(time);
    if (new Date(at).getUTCHours() !== 0 || at < start || at > end) return;
    result.times.push(new Date(at).toISOString());
    result.flow.push(values[index] ?? null);
  });
  return result;
}
