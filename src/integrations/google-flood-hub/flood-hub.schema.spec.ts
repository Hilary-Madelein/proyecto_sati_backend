import {
  floodStatusResponseSchema,
  gaugesGeoJsonSchema,
  statusesToFloodHubGauges,
  toFloodHubGauges,
} from './flood-hub.schema.js';

describe('statusesToFloodHubGauges', () => {
  it('normaliza la respuesta de la API de Google', () => {
    const data = floodStatusResponseSchema.parse({
      floodStatuses: [
        {
          gaugeId: 'hybas_6120032320',
          qualityVerified: true,
          gaugeLocation: { latitude: -3.4271, longitude: -80.2396 },
          issuedTime: '2026-11-01T00:39:55Z',
          forecastTimeRange: { start: '2026-11-03T00:00:00Z', end: '2026-11-04T00:00:00Z' },
          forecastTrend: 'RISE',
          severity: 'SEVERE',
          mapInferenceType: 'MODEL',
        },
      ],
    });
    expect(statusesToFloodHubGauges(data)).toEqual([
      {
        id: 'hybas_6120032320',
        lat: -3.4271,
        lng: -80.2396,
        severity: 'severe',
        trend: 'rise',
        verified: true,
        issuedAt: '2026-11-01T00:39:55Z',
        forecastFrom: '2026-11-03T00:00:00Z',
        forecastTo: '2026-11-04T00:00:00Z',
      },
    ]);
  });

  it('acepta una respuesta vacía y descarta los puntos sin ubicación', () => {
    expect(statusesToFloodHubGauges(floodStatusResponseSchema.parse({}))).toEqual([]);
    const data = floodStatusResponseSchema.parse({ floodStatuses: [{ gaugeId: 'x', severity: 'UNKNOWN' }] });
    expect(statusesToFloodHubGauges(data)).toEqual([]);
  });
});

describe('toFloodHubGauges', () => {
  const feature = (properties: Record<string, unknown>, coordinates: [number, number] | null = [-80.2396, -3.4271]) => ({
    type: 'Feature',
    geometry: coordinates ? { type: 'Point', coordinates } : null,
    properties: { id: 'hybas_6120032320', ...properties },
  });

  it('normaliza severidad, tendencia y fechas de cada punto', () => {
    const data = gaugesGeoJsonSchema.parse({
      type: 'FeatureCollection',
      features: [
        feature({
          verified: false,
          severity: 'ABOVE_NORMAL',
          trend: 'RISE',
          issued: '2026-10-25T00:39:55.659124Z',
          from: '2026-10-28T00:00:00Z',
          to: '2026-10-29T00:00:00Z',
        }),
      ],
    });
    expect(toFloodHubGauges(data)).toEqual([
      {
        id: 'hybas_6120032320',
        lat: -3.4271,
        lng: -80.2396,
        severity: 'above_normal',
        trend: 'rise',
        verified: false,
        issuedAt: '2026-10-25T00:39:55.659124Z',
        forecastFrom: '2026-10-28T00:00:00Z',
        forecastTo: '2026-10-29T00:00:00Z',
      },
    ]);
  });

  it('deja como "unknown" los valores que no conoce y descarta los puntos sin coordenadas', () => {
    const data = gaugesGeoJsonSchema.parse({
      features: [feature({ severity: 'SEVERITY_UNSPECIFIED', trend: null }), feature({ severity: 'EXTREME' }, null)],
    });
    expect(toFloodHubGauges(data)).toMatchObject([{ severity: 'unknown', trend: 'unknown', verified: false, issuedAt: null }]);
  });
});
