import { forecastStatsSchema } from './geoglows.schema.js';

describe('forecastStatsSchema', () => {
  it('convierte valores vacíos en null y conserva los números', () => {
    const series = [287, '', '291.5'];
    const parsed = forecastStatsSchema.parse({
      datetime: ['a', 'b', 'c'],
      flow_min: series,
      flow_25p: series,
      flow_med: series,
      flow_avg: series,
      flow_75p: series,
      flow_max: series,
      high_res: [284.8, 287.4, null],
      metadata: { gen_date: '2026-10-03T23:02:52+00:00' },
    });
    expect(parsed.flow_med).toEqual([287, null, 291.5]);
    expect(parsed.high_res).toEqual([284.8, 287.4, null]);
  });
});
