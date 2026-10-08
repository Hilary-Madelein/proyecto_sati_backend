import type { ArchivedRiverForecast, RiverForecastMembers } from './river.js';

/** Un dato vacío queda vacío en el CSV (nunca 0), como en GEOGLOWS. */
const cell = (value: number | null) => (value === null ? '' : String(value));
const toCsv = (header: string[], rows: string[][]) => [header, ...rows].map((row) => row.join(',')).join('\n') + '\n';

/** Estadísticas de una corrida, con los nombres de columna de `forecaststats` de GEOGLOWS. */
export function forecastStatsCsv(forecast: ArchivedRiverForecast): string {
  const { ensemble, highRes } = forecast;
  return toCsv(
    ['datetime', 'flow_min', 'flow_25p', 'flow_med', 'flow_avg', 'flow_75p', 'flow_max', 'high_res'],
    forecast.times.map((time, index) => [
      time,
      ...[ensemble.min, ensemble.p25, ensemble.median, ensemble.mean, ensemble.p75, ensemble.max, highRes].map((series) =>
        cell(series[index]),
      ),
    ]),
  );
}

/** Los 52 miembros de una corrida, con los nombres de columna de `forecastensemble` (`ensemble_52` = alta resolución). */
export function forecastMembersCsv(data: RiverForecastMembers): string {
  return toCsv(
    ['datetime', ...data.members.map((member) => `ensemble_${String(member.member).padStart(2, '0')}`)],
    data.times.map((time, index) => [time, ...data.members.map((member) => cell(member.flow[index]))]),
  );
}
