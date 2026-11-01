import type { AppConfigService } from '../../config/app-config.service.js';
import { FloodHubApiSource } from './flood-hub-api.source.js';

const status = (gaugeId: string) => ({ gaugeId, gaugeLocation: { latitude: -1, longitude: -79 }, severity: 'NO_FLOODING' });

describe('FloodHubApiSource', () => {
  const config = {
    get: (key: string) =>
      ({ GOOGLE_FLOOD_API_KEY: 'clave-de-prueba', FLOOD_FORECASTING_API_URL: 'https://google.test/v1' })[key],
  } as unknown as AppConfigService;

  afterEach(() => vi.unstubAllGlobals());

  it('recorre las páginas y manda la clave en la cabecera, nunca en la URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ floodStatuses: [status('a')], nextPageToken: 'pagina-2' }))
      .mockResolvedValueOnce(Response.json({ floodStatuses: [status('b')] }));
    vi.stubGlobal('fetch', fetchMock);

    const gauges = await new FloodHubApiSource(config).getGauges();

    expect(gauges.map((gauge) => gauge.id)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://google.test/v1/floodStatus:searchLatestFloodStatusByArea');
    expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('clave-de-prueba');
    expect(JSON.parse(init?.body as string)).toEqual({
      regionCode: 'EC',
      includeNonQualityVerified: true,
      pageToken: 'pagina-2',
    });
  });

  it('pide solo el Ecuador y arma una zona por nivel de probabilidad, con su vigencia', async () => {
    const kml = (points: string) =>
      `<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${points}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('flashFloods:search')) {
        return Response.json({
          flashFloodEvents: [
            {
              forecastIssueTime: '2026-11-01T12:00:00Z',
              forecastPeriodHours: 24,
              affectedCountryCodes: ['EC', 'PE'],
              likelyAffectedPolygonId: 'probable',
              highlyLikelyAffectedPolygonId: 'muy-probable',
              eventPolygonId: 'contorno',
            },
          ],
        });
      }
      return Response.json({ kml: kml('-80,-3 -79,-3 -79,-2 -80,-3') });
    });
    vi.stubGlobal('fetch', fetchMock);

    const areas = await new FloodHubApiSource(config).getFlashFloods();

    expect(areas.map((area) => [area.id, area.likelihood])).toEqual([
      ['probable', 'likely'],
      ['muy-probable', 'highly_likely'],
    ]);
    expect(areas[0]).toMatchObject({ validUntil: '2026-11-02T12:00:00.000Z', countries: ['EC', 'PE'] });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ countryCodes: ['EC'] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
