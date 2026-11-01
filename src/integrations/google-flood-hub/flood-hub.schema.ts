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

/** Respuesta de floodStatus:searchLatestFloodStatusByArea. Sin resultados, `floodStatuses` no viene. */
export const floodStatusResponseSchema = z.object({
  floodStatuses: z
    .array(
      z.object({
        gaugeId: z.string(),
        qualityVerified: z.boolean().nullish(),
        gaugeLocation: z.object({ latitude: z.number(), longitude: z.number() }).nullish(),
        issuedTime: optionalText,
        forecastTimeRange: z.object({ start: optionalText, end: optionalText }).nullish(),
        forecastTrend: optionalText,
        severity: optionalText,
      }),
    )
    .default([]),
  nextPageToken: z.string().nullish(),
});

/** Respuesta de flashFloods:search. Sin eventos, `flashFloodEvents` no viene. */
export const flashFloodsResponseSchema = z.object({
  flashFloodEvents: z
    .array(
      z.object({
        forecastIssueTime: z.string(),
        forecastPeriodHours: z.number(),
        affectedCountryCodes: z.array(z.string()).default([]),
        likelyAffectedPolygonId: z.string().nullish(),
        highlyLikelyAffectedPolygonId: z.string().nullish(),
      }),
    )
    .default([]),
  nextPageToken: z.string().nullish(),
});

export const serializedPolygonSchema = z.object({ kml: z.string() });

export function statusesToFloodHubGauges(data: z.infer<typeof floodStatusResponseSchema>): FloodHubGauge[] {
  return data.floodStatuses.flatMap((status) => {
    if (!status.gaugeLocation) return [];
    return [
      {
        id: status.gaugeId,
        lat: status.gaugeLocation.latitude,
        lng: status.gaugeLocation.longitude,
        severity: SEVERITIES[status.severity ?? ''] ?? 'unknown',
        trend: TRENDS[status.forecastTrend ?? ''] ?? 'unknown',
        verified: status.qualityVerified ?? false,
        issuedAt: status.issuedTime,
        forecastFrom: status.forecastTimeRange?.start ?? null,
        forecastTo: status.forecastTimeRange?.end ?? null,
      },
    ];
  });
}

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
