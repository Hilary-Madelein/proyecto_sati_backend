import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { ensembleStats, normalizeRunDate } from '../../modules/hydrology/domain/ensemble-stats.js';
import type {
  ArchivedRiverForecast,
  ForecastRun,
  ForecastRunsCatalog,
  RiverForecastMembers,
} from '../../modules/hydrology/domain/river.js';
import { RiverForecastArchive } from '../../modules/hydrology/river-sources.js';
import { ForecastZarrArchive, parseS3Listing } from './forecast-zarr.js';
import { forecastStatsSchema } from './geoglows.schema.js';

const SERVICE = 'GEOGLOWS';
const MEMBERS = 52;

const datesSchema = z.object({ dates: z.array(z.string()) });
/** GET /forecastensemble/{river_id}?date=: `ensemble_01` … `ensemble_52`, con "" donde no hay dato. */
const ensembleSchema = z.looseObject({ datetime: z.array(z.string()) }).catchall(z.unknown());
const memberSeries = z.array(
  z.union([z.number(), z.string(), z.null()]).transform((value) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : null;
  }),
);

const toIso = (time: string) => new Date(time).toISOString();
const range = (dates: string[]) => (dates.length > 0 ? { from: dates.at(-1)!, to: dates[0] } : null);

/**
 * Pronósticos ya emitidos de GEOGLOWS. Las corridas recientes (unas semanas)
 * salen de la API REST, que es rápida; las anteriores, desde julio de 2024, del
 * archivo Zarr público en AWS (sin credenciales), que es lento. Las
 * estadísticas del archivo se calculan igual que las de la API.
 */
@Injectable()
export class GeoglowsArchiveSource extends RiverForecastArchive {
  private readonly zarr: ForecastZarrArchive;

  constructor(private readonly config: AppConfigService) {
    super();
    this.zarr = new ForecastZarrArchive(config.get('GEOGLOWS_FORECAST_ARCHIVE_URL'));
  }

  async listRuns(): Promise<ForecastRunsCatalog> {
    const [apiDates, archiveDates] = await Promise.all([this.apiDates(), this.archiveDates()]);
    const api = new Set(apiDates);
    const runs: ForecastRun[] = [...new Set([...apiDates, ...archiveDates])]
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({ date, origin: api.has(date) ? 'api' : 'archive' }));
    return {
      runs,
      api: range(runs.filter((run) => run.origin === 'api').map((run) => run.date)),
      archive: range(archiveDates.toSorted((a, b) => b.localeCompare(a))),
    };
  }

  async getRunForecast(riverId: number, run: ForecastRun): Promise<ArchivedRiverForecast> {
    const base = { riverId, run: run.date, origin: run.origin, source: 'GEOGLOWS · ECMWF', unit: 'm3/s' as const };
    if (run.origin === 'archive') {
      const { times, members } = await this.zarr.members(riverId, run.date);
      return { ...base, generatedAt: null, times, ...ensembleStats(members) };
    }

    const parsed = forecastStatsSchema.safeParse(await this.api(`forecaststats/${riverId}`, run.date));
    if (!parsed.success) throw new UpstreamError(SERVICE, 'respuesta de pronóstico con formato inesperado');
    const stats = parsed.data;
    return {
      ...base,
      generatedAt: stats.metadata?.gen_date ?? null,
      times: stats.datetime.map(toIso),
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

  async getRunMembers(riverId: number, run: ForecastRun): Promise<RiverForecastMembers> {
    let times: string[];
    let members: Array<Array<number | null>>;
    if (run.origin === 'archive') {
      ({ times, members } = await this.zarr.members(riverId, run.date));
    } else {
      const parsed = ensembleSchema.safeParse(await this.api(`forecastensemble/${riverId}`, run.date));
      if (!parsed.success) throw new UpstreamError(SERVICE, 'respuesta del ensamble con formato inesperado');
      times = parsed.data.datetime.map(toIso);
      members = Array.from({ length: MEMBERS }, (_, index) => {
        const series = memberSeries.safeParse(parsed.data[`ensemble_${String(index + 1).padStart(2, '0')}`]);
        return series.success ? series.data : times.map(() => null);
      });
    }
    return {
      riverId,
      run: run.date,
      origin: run.origin,
      unit: 'm3/s',
      times,
      members: members.map((flow, index) => ({ member: index + 1, highRes: index === MEMBERS - 1, flow })),
    };
  }

  /** Corridas que la API REST sirve (≈ los últimos dos meses). */
  private async apiDates(): Promise<string[]> {
    const parsed = datesSchema.safeParse(await this.api('dates'));
    if (!parsed.success) throw new UpstreamError(SERVICE, 'listado de fechas con formato inesperado');
    return parsed.data.dates.map(normalizeRunDate).filter((date): date is string => date !== null);
  }

  /** Corridas del archivo AWS: listado S3 de carpetas, de a 1000. Si falla, solo se ofrecen las de la API. */
  private async archiveDates(): Promise<string[]> {
    const base = this.config.get('GEOGLOWS_FORECAST_ARCHIVE_URL').replace(/\/+$/, '');
    const dates: string[] = [];
    let token: string | null = null;
    try {
      do {
        const url = new URL(`${base}/`);
        url.searchParams.set('list-type', '2');
        url.searchParams.set('delimiter', '/');
        if (token) url.searchParams.set('continuation-token', token);
        const page = parseS3Listing(await (await fetchWithRetry(url, { service: `${SERVICE} (archivo AWS)`, timeoutMs: 30_000 })).text());
        dates.push(...page.dates);
        token = page.nextToken;
      } while (token);
    } catch {
      return [];
    }
    return dates;
  }

  private async api(path: string, date?: string): Promise<unknown> {
    const url = new URL(`${this.config.get('GEOGLOWS_API_URL').replace(/\/+$/, '')}/${path}`);
    url.searchParams.set('format', 'json');
    if (date) url.searchParams.set('date', date);
    const response = await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000, retries: 1 });
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new UpstreamError(SERVICE, 'la respuesta no es JSON válido');
    }
  }
}
