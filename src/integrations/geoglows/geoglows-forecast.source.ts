import { Injectable, Logger } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { annualMaxima, antecedentConditions, gumbelReturnPeriods } from '../../modules/hydrology/domain/return-periods.js';
import type { RiverForecast, RiverReturnPeriods } from '../../modules/hydrology/domain/river.js';
import { RiverForecastSource } from '../../modules/hydrology/river-sources.js';
import {
  forecastRecordsSchema,
  forecastStatsSchema,
  retrospectiveDailySchema,
  retrospectiveSeries,
  riverIdSchema,
} from './geoglows.schema.js';

const SERVICE = 'GEOGLOWS';
/** Días de condiciones antecedentes (como el Hydroviewer del INAMHI). */
const ANTECEDENT_DAYS = 8;
/** Años de la simulación histórica para los periodos de retorno (como el Hydroviewer del INAMHI). */
const RETURN_PERIODS_FROM_YEAR = 1980;

/**
 * Pronóstico de caudal de la API pública de GEOGLOWS (v2): 15 días cada 3 h
 * del ensamble ECMWF, más el pronóstico de alta resolución. Se actualiza a diario.
 * Los periodos de retorno se calculan con su simulación histórica, porque su
 * endpoint `returnperiods` responde con error.
 */
@Injectable()
export class GeoglowsForecastSource extends RiverForecastSource {
  private readonly logger = new Logger(GeoglowsForecastSource.name);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async findRiverId(latitude: number, longitude: number): Promise<number | null> {
    const data = await this.get('getriverid', { lat: latitude.toFixed(5), lon: longitude.toFixed(5) });
    const parsed = riverIdSchema.safeParse(data);
    return parsed.success ? parsed.data.river_id : null;
  }

  async getForecast(riverId: number): Promise<RiverForecast> {
    const [statsResponse, antecedent] = await Promise.all([
      this.get(`forecaststats/${riverId}`, { format: 'json' }),
      this.getAntecedent(riverId),
    ]);
    const parsed = forecastStatsSchema.safeParse(statsResponse);
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
      antecedent:
        antecedent && stats.datetime[0]
          ? antecedentConditions(antecedent.datetime, antecedent.average_flow, stats.datetime[0], ANTECEDENT_DAYS)
          : null,
    };
  }

  /** Máximos anuales de la simulación histórica diaria (~16 s y ~0,5 MB: el servicio la cachea). */
  async getReturnPeriods(riverId: number): Promise<RiverReturnPeriods> {
    const data = retrospectiveDailySchema.safeParse(
      await this.get(`retrospectivedaily/${riverId}`, { format: 'json', start_date: `${RETURN_PERIODS_FROM_YEAR}0101` }, 90_000),
    );
    const values = data.success ? retrospectiveSeries.safeParse(data.data[String(riverId)]) : null;
    if (!data.success || !values?.success) throw new UpstreamError(SERVICE, 'simulación histórica con formato inesperado');

    const thresholds = gumbelReturnPeriods(annualMaxima(data.data.datetime, values.data, RETURN_PERIODS_FROM_YEAR));
    if (thresholds.length === 0) throw new UpstreamError(SERVICE, 'la simulación histórica no tiene años suficientes');
    return { riverId, method: `Gumbel · simulación histórica ${RETURN_PERIODS_FROM_YEAR}–hoy`, thresholds };
  }

  /** El registro de pronósticos anteriores es opcional: si falla, el pronóstico se muestra igual. */
  private async getAntecedent(riverId: number) {
    try {
      const parsed = forecastRecordsSchema.safeParse(await this.get(`forecastrecords/${riverId}`, { format: 'json' }));
      return parsed.success ? parsed.data : null;
    } catch (error) {
      this.logger.warn(`Sin condiciones antecedentes para ${riverId}: ${(error as Error).message}`);
      return null;
    }
  }

  private async get(path: string, query: Record<string, string>, timeoutMs = 30_000): Promise<unknown> {
    const url = new URL(`${this.config.get('GEOGLOWS_API_URL').replace(/\/+$/, '')}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const response = await fetchWithRetry(url, { service: SERVICE, timeoutMs, retries: 1 });
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new UpstreamError(SERVICE, 'la respuesta no es JSON válido');
    }
  }
}
