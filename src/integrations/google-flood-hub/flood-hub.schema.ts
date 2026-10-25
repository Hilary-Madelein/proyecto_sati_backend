import { z } from 'zod';
import type { FloodHubGauge, FloodHubSeverity, FloodHubTrend } from '../../modules/flood-hub/flood-hub-source.js';

/** Valores de la API de Google Flood Forecasting (FloodStatus.severity). */
const SEVERITIES: Record<string, FloodHubSeverity> = {
  EXTREME: 'extreme',
  SEVERE: 'severe',
  ABOVE_NORMAL: 'above_normal',
  NO_FLOODING: 'no_flooding',
};

const TRENDS: Record<string, FloodHubTrend> = { RISE: 'rise', FALL: 'fall', NO_CHANGE: 'no_change' };

const optionalText = z.string().nullish().transform((value) => value || null);

export const gaugesGeoJsonSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.unknown()) }).nullable(),
      properties: z.object({
        id: z.string(),
        verified: z.boolean().nullish(),
        severity: optionalText,
        trend: optionalText,
        issued: optionalText,
        from: optionalText,
        to: optionalText,
      }),
    }),
  ),
});

/** Puntos con coordenadas, con severidad y tendencia normalizadas (lo desconocido queda como "unknown"). */
export function toFloodHubGauges(data: z.infer<typeof gaugesGeoJsonSchema>): FloodHubGauge[] {
  return data.features.flatMap(({ geometry, properties }) => {
    if (!geometry) return [];
    const [lng, lat] = geometry.coordinates;
    return [
      {
        id: properties.id,
        lat,
        lng,
        severity: SEVERITIES[properties.severity ?? ''] ?? 'unknown',
        trend: TRENDS[properties.trend ?? ''] ?? 'unknown',
        verified: properties.verified ?? false,
        issuedAt: properties.issued,
        forecastFrom: properties.from,
        forecastTo: properties.to,
      },
    ];
  });
}
