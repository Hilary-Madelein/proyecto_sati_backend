import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { RiverForecast } from '../../modules/hydrology/domain/river.js';
import { RiverForecastSource } from '../../modules/hydrology/river-sources.js';
import { forecastStatsSchema, riverIdSchema } from './geoglows.schema.js';

const SERVICE = 'GEOGLOWS';

/**
 * Pronóstico de caudal de la API pública de GEOGLOWS (v2): 15 días cada 3 h
 * del ensamble ECMWF, más el pronóstico de alta resolución. Se actualiza a diario.
 */
@Injectable()
export class GeoglowsForecastSource extends RiverForecastSource {
  constructor(private readonly config: AppConfigService) {
    super();
  }

  async findRiverId(latitude: number, longitude: number): Promise<number | null> {
    const data = await this.get('getriverid', { lat: latitude.toFixed(5), lon: longitude.toFixed(5) });
    const parsed = riverIdSchema.safeParse(data);
    return parsed.success ? parsed.data.river_id : null;
  }

  async getForecast(riverId: number): Promise<RiverForecast> {
    const parsed = forecastStatsSchema.safeParse(await this.get(`forecaststats/${riverId}`, { format: 'json' }));
    if (!parsed.success) throw new UpstreamError(SERVICE, 'respuesta de pronóstico con formato inesperado');
    const stats = parsed.data;

    return {
      riverId,
      source: 'GEOGLOWS · ECMWF',
      generatedAt: stats.metadata?.gen_date ?? null,
      unit: 'm3/s',
      times: stats.datetime,
      highRes: stats.high_res,
      ensemble: {
        min: stats.flow_min,
        p25: stats.flow_25p,
        median: stats.flow_med,
        mean: stats.flow_avg,
        p75: stats.flow_75p,
        max: stats.flow_max,
      },
    };
  }

  private async get(path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.config.get('GEOGLOWS_API_URL').replace(/\/+$/, '')}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const response = await fetchWithRetry(url, { service: SERVICE, timeoutMs: 30_000, retries: 1 });
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new UpstreamError(SERVICE, 'la respuesta no es JSON válido');
    }
  }
}
