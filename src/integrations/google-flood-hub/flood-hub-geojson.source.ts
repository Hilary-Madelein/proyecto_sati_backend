import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { FloodHubSource, type FloodHubGauge } from '../../modules/flood-hub/flood-hub-source.js';
import { gaugesGeoJsonSchema, toFloodHubGauges } from './flood-hub.schema.js';

const SERVICE = 'Flood Hub';

/**
 * Último estado de Flood Hub publicado como GeoJSON (FLOOD_HUB_GAUGES_URL). El
 * demo GDE-Niño lo arma a diario con la API de Google Flood Forecasting; los
 * campos son los de su FloodStatus (severity, trend, issuedTime, forecastTimeRange).
 */
@Injectable()
export class FloodHubGeoJsonSource extends FloodHubSource {
  readonly attribution = 'Google Flood Hub (CC BY 4.0), vía el demo GDE-Niño';

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getGauges(): Promise<FloodHubGauge[]> {
    const response = await fetchWithRetry(this.config.get('FLOOD_HUB_GAUGES_URL'), { service: SERVICE, timeoutMs: 30_000 });
    const parsed = gaugesGeoJsonSchema.safeParse(await response.json());
    if (!parsed.success) throw new UpstreamError(SERVICE, 'respondió con un formato inesperado');
    return toFloodHubGauges(parsed.data);
  }
}
