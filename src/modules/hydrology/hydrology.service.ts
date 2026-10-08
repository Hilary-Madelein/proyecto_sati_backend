import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { normalizeRunDate } from './domain/ensemble-stats.js';
import type {
  ArchivedRiverForecast,
  ForecastRun,
  ForecastRunsCatalog,
  RiverAlert,
  RiverAlertsSnapshot,
  RiverForecast,
  RiverForecastMembers,
  RiverReturnPeriods,
} from './domain/river.js';
import { RiverAlertSource, RiverForecastArchive, RiverForecastSource } from './river-sources.js';

const MINUTE_MS = 60 * 1000;
/** Las alertas se refrescan antes de que venza la caché: ningún usuario espera la descarga. */
const ALERTS_REFRESH_MS = 25 * MINUTE_MS;

@Injectable()
export class HydrologyService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HydrologyService.name);
  private refreshTimer?: NodeJS.Timeout;
  // Las fuentes se actualizan una vez al día: cachés cortas bastan y evitan saturarlas.
  private alertsCache = new TtlCache<RiverAlertsSnapshot>(30 * MINUTE_MS, 1);
  private readonly forecastCache = new TtlCache<RiverForecast>(30 * MINUTE_MS);
  private readonly riverIdCache = new TtlCache<number | null>(24 * 60 * MINUTE_MS, 5_000);
  // Salen de 45 años de simulación histórica: casi no cambian y cuestan ~16 s por río.
  private readonly returnPeriodsCache = new TtlCache<RiverReturnPeriods>(30 * 24 * 60 * MINUTE_MS, 2_000);
  // Corridas pasadas: no cambian nunca, pero las del archivo AWS tardan decenas de segundos.
  private readonly runsCache = new TtlCache<ForecastRunsCatalog>(3 * 60 * MINUTE_MS, 1);
  private readonly archivedCache = new TtlCache<ArchivedRiverForecast>(7 * 24 * 60 * MINUTE_MS, 300);
  private readonly membersCache = new TtlCache<RiverForecastMembers>(24 * 60 * MINUTE_MS, 50);

  constructor(
    private readonly forecasts: RiverForecastSource,
    private readonly alertSource: RiverAlertSource,
    private readonly archive: RiverForecastArchive,
  ) {}

  onApplicationBootstrap(): void {
    this.warmAlerts();
    this.refreshTimer = setInterval(() => this.warmAlerts(), ALERTS_REFRESH_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  getAlerts(): Promise<RiverAlertsSnapshot> {
    return this.upstream(this.alertsCache.get('latest', () => this.alertSource.getLatestAlerts()));
  }

  /** Tramo más cercano a un punto y, si tiene, su alerta del pronóstico vigente. */
  async findRiverAt(latitude: number, longitude: number): Promise<{ riverId: number; alert: RiverAlert | null }> {
    // ~100 m de redondeo: clics muy cercanos reutilizan la misma consulta.
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const riverId = await this.upstream(this.riverIdCache.get(key, () => this.forecasts.findRiverId(latitude, longitude)));
    if (riverId === null) throw new NotFoundException('No hay un río cerca de ese punto');
    return { riverId, alert: await this.findAlert(riverId) };
  }

  getForecast(riverId: number): Promise<RiverForecast> {
    return this.upstream(this.forecastCache.get(String(riverId), () => this.forecasts.getForecast(riverId)));
  }

  /** Corridas de pronóstico disponibles (API REST y archivo AWS). */
  getForecastRuns(): Promise<ForecastRunsCatalog> {
    return this.upstream(this.runsCache.get('all', () => this.archive.listRuns()));
  }

  /** Lo que pronosticaba la corrida de `date` para un tramo (estadísticas del ensamble). */
  async getArchivedForecast(riverId: number, date: string): Promise<ArchivedRiverForecast> {
    const run = await this.findRun(date);
    return this.upstream(this.archivedCache.get(`${riverId}:${run.date}`, () => this.archive.getRunForecast(riverId, run)));
  }

  /** Los 52 miembros de la corrida de `date` para un tramo. */
  async getArchivedMembers(riverId: number, date: string): Promise<RiverForecastMembers> {
    const run = await this.findRun(date);
    return this.upstream(this.membersCache.get(`${riverId}:${run.date}`, () => this.archive.getRunMembers(riverId, run)));
  }

  private async findRun(date: string): Promise<ForecastRun> {
    const normalized = normalizeRunDate(date);
    if (!normalized) throw new BadRequestException('Fecha de corrida inválida: usa AAAA-MM-DD o AAAAMMDD');
    const catalog = await this.getForecastRuns();
    const run = catalog.runs.find((item) => item.date === normalized);
    if (!run) {
      const oldest = catalog.archive?.from ?? catalog.api?.from;
      const newest = catalog.api?.to ?? catalog.archive?.to;
      throw new NotFoundException(`No hay corrida del ${normalized}. Disponibles del ${oldest ?? '—'} al ${newest ?? '—'}`);
    }
    return run;
  }

  getReturnPeriods(riverId: number): Promise<RiverReturnPeriods> {
    return this.upstream(this.returnPeriodsCache.get(String(riverId), () => this.forecasts.getReturnPeriods(riverId)));
  }

  /** Descarga las alertas en segundo plano y solo reemplaza la caché si salió bien. */
  private warmAlerts(): void {
    const fresh = new TtlCache<RiverAlertsSnapshot>(30 * MINUTE_MS, 1);
    fresh
      .get('latest', () => this.alertSource.getLatestAlerts())
      .then(() => (this.alertsCache = fresh))
      .catch((error: unknown) => this.logger.warn(`No se pudieron actualizar las alertas de ríos: ${(error as Error).message}`));
  }

  private async findAlert(riverId: number): Promise<RiverAlert | null> {
    try {
      return (await this.getAlerts()).alerts.find((alert) => alert.riverId === riverId) ?? null;
    } catch {
      // Sin alertas disponibles el río igual se puede consultar.
      return null;
    }
  }

  /** Traduce fallas de servicios externos a 502, con un mensaje legible. */
  private async upstream<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }
}
