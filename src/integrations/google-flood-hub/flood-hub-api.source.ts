import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import {
  FloodHubSource,
  type FlashFloodArea,
  type FlashFloodLikelihood,
  type FloodHubGauge,
} from '../../modules/flood-hub/flood-hub-source.js';
import {
  flashFloodsResponseSchema,
  floodStatusResponseSchema,
  serializedPolygonSchema,
  statusesToFloodHubGauges,
} from './flood-hub.schema.js';
import { kmlToMultiPolygon } from './flood-polygon-kml.js';

const SERVICE = 'Google Flood Forecasting';
const REGION_CODE = 'EC';

/**
 * Último estado de los puntos del Ecuador y crecidas repentinas urbanas, directo
 * de la API de Google Flood Forecasting. La clave va en una cabecera para que no
 * aparezca en URLs ni logs.
 */
@Injectable()
export class FloodHubApiSource extends FloodHubSource {
  readonly attribution = 'Google Flood Hub (CC BY 4.0)';

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getGauges(): Promise<FloodHubGauge[]> {
    const gauges: FloodHubGauge[] = [];
    let pageToken: string | undefined;

    do {
      const json = await this.post('floodStatus:searchLatestFloodStatusByArea', {
        regionCode: REGION_CODE,
        includeNonQualityVerified: true,
        pageToken,
      });
      const parsed = floodStatusResponseSchema.safeParse(json);
      if (!parsed.success) throw new UpstreamError(SERVICE, 'respondió con un formato inesperado');
      gauges.push(...statusesToFloodHubGauges(parsed.data));
      pageToken = parsed.data.nextPageToken || undefined;
    } while (pageToken);

    return gauges;
  }

  async getFlashFloods(): Promise<FlashFloodArea[]> {
    const requests: { polygonId: string; likelihood: FlashFloodLikelihood; base: Omit<FlashFloodArea, 'id' | 'likelihood' | 'geometry'> }[] = [];
    let pageToken: string | undefined;

    do {
      const json = await this.post('flashFloods:search', { countryCodes: [REGION_CODE], pageToken });
      const parsed = flashFloodsResponseSchema.safeParse(json);
      if (!parsed.success) throw new UpstreamError(SERVICE, 'respondió con un formato inesperado');
      for (const event of parsed.data.flashFloodEvents) {
        const issued = Date.parse(event.forecastIssueTime);
        const base = {
          issuedAt: event.forecastIssueTime,
          validUntil: new Date(issued + event.forecastPeriodHours * 3_600_000).toISOString(),
          countries: event.affectedCountryCodes,
        };
        // eventPolygonId es el contorno del evento: repite estas zonas y no aporta otro nivel.
        if (event.likelyAffectedPolygonId) requests.push({ polygonId: event.likelyAffectedPolygonId, likelihood: 'likely', base });
        if (event.highlyLikelyAffectedPolygonId) {
          requests.push({ polygonId: event.highlyLikelyAffectedPolygonId, likelihood: 'highly_likely', base });
        }
      }
      pageToken = parsed.data.nextPageToken || undefined;
    } while (pageToken);

    const areas = await Promise.all(
      requests.map(async ({ polygonId, likelihood, base }) => {
        const geometry = kmlToMultiPolygon(await this.getPolygonKml(polygonId));
        return geometry ? [{ id: polygonId, likelihood, ...base, geometry }] : [];
      }),
    );
    return areas.flat();
  }

  private async getPolygonKml(polygonId: string): Promise<string> {
    const url = `${this.config.get('FLOOD_FORECASTING_API_URL')}/serializedPolygons/${encodeURIComponent(polygonId)}`;
    const response = await fetchWithRetry(url, { service: SERVICE, timeoutMs: 30_000, headers: this.authHeaders() });
    const parsed = serializedPolygonSchema.safeParse(await response.json());
    if (!parsed.success) throw new UpstreamError(SERVICE, 'respondió con un formato inesperado');
    return parsed.data.kml;
  }

  private async post(method: string, body: object): Promise<unknown> {
    const response = await fetchWithRetry(`${this.config.get('FLOOD_FORECASTING_API_URL')}/${method}`, {
      service: SERVICE,
      timeoutMs: 30_000,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(body),
    });
    return response.json();
  }

  private authHeaders() {
    return { 'X-Goog-Api-Key': this.config.get('GOOGLE_FLOOD_API_KEY') ?? '' };
  }
}
