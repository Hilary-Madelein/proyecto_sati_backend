import { z } from 'zod';

/** Valores numéricos que a veces llegan vacíos (""): se convierten en null. */
const series = z.array(
  z.union([z.number(), z.string(), z.null()]).transform((value) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : null;
  }),
);

/** GET /getriverid?lat=&lon= */
export const riverIdSchema = z.object({ river_id: z.coerce.number().int().positive() });

/** GET /forecastrecords/{river_id}?format=json: primer tramo de los pronósticos de días anteriores. */
export const forecastRecordsSchema = z.looseObject({
  datetime: z.array(z.string()),
  average_flow: series,
});

/** GET /retrospectivedaily/{river_id}?format=json: simulación histórica diaria (la serie va con el id como clave). */
export const retrospectiveDailySchema = z.looseObject({ datetime: z.array(z.string()) }).catchall(z.unknown());
export const retrospectiveSeries = series;

/** GET /forecaststats/{river_id}?format=json */
export const forecastStatsSchema = z.looseObject({
  datetime: z.array(z.string()),
  flow_min: series,
  flow_25p: series,
  flow_med: series,
  flow_avg: series,
  flow_75p: series,
  flow_max: series,
  high_res: series,
  metadata: z.looseObject({ gen_date: z.string().nullish() }).optional(),
});
