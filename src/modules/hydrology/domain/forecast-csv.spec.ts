import { forecastMembersCsv, forecastStatsCsv } from './forecast-csv.js';
import type { ArchivedRiverForecast, RiverForecastMembers } from './river.js';

const times = ['2025-03-15T00:00:00.000Z', '2025-03-15T01:00:00.000Z'];

describe('forecastStatsCsv', () => {
  it('usa las columnas de GEOGLOWS y deja vacíos los datos que faltan', () => {
    const forecast = {
      riverId: 1,
      run: '20250315',
      origin: 'archive',
      source: 'GEOGLOWS · ECMWF',
      generatedAt: null,
      unit: 'm3/s',
      times,
      highRes: [2.5, 2.1],
      ensemble: { min: [1, null], p25: [1.2, null], median: [1.5, null], mean: [1.6, null], p75: [1.8, null], max: [2, null] },
    } satisfies ArchivedRiverForecast;

    expect(forecastStatsCsv(forecast)).toBe(
      'datetime,flow_min,flow_25p,flow_med,flow_avg,flow_75p,flow_max,high_res\n' +
        '2025-03-15T00:00:00.000Z,1,1.2,1.5,1.6,1.8,2,2.5\n' +
        '2025-03-15T01:00:00.000Z,,,,,,,2.1\n',
    );
  });
});

describe('forecastMembersCsv', () => {
  it('una columna por miembro, ensemble_01 … ensemble_52', () => {
    const data = {
      riverId: 1,
      run: '20250315',
      origin: 'api',
      unit: 'm3/s',
      times,
      members: [
        { member: 1, highRes: false, flow: [0.4, null] },
        { member: 52, highRes: true, flow: [0.9, 0.8] },
      ],
    } satisfies RiverForecastMembers;

    expect(forecastMembersCsv(data)).toBe(
      'datetime,ensemble_01,ensemble_52\n2025-03-15T00:00:00.000Z,0.4,0.9\n2025-03-15T01:00:00.000Z,,0.8\n',
    );
  });
});
