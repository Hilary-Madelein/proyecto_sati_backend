import { gaugesGeoJsonSchema, toFloodHubGauges } from './flood-hub.schema.js';

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
