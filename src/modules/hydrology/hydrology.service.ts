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
import { toEcuadorDate } from '../../common/time/ecuador-time.js';
import {
  alertPersistence,
  PERSISTENCE_WINDOW_DAYS,
  PERSISTENT_SHARE,
  withPersistence,
  type AlertPersistence,
} from './domain/alert-persistence.js';
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
const DAY_MS = 24 * 60 * MINUTE_MS;

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
  // Persistencia de las alertas (pronósticos de los últimos 30 días): se recalcula una vez al día.
  private persistence: { value: AlertPersistence; computedAt: number } | null = null;
  private persistenceLoading = false;

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

  async getAlerts(): Promise<RiverAlertsSnapshot> {
    const snapshot = await this.upstream(this.alertsCache.get('latest', () => this.alertSource.getLatestAlerts()));
    return withPersistence(snapshot, this.persistence?.value ?? null);
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
    if (!this.persistence || Date.now() - this.persistence.computedAt > DAY_MS) void this.refreshPersistence();
    const fresh = new TtlCache<RiverAlertsSnapshot>(30 * MINUTE_MS, 1);
    fresh
      .get('latest', () => this.alertSource.getLatestAlerts())
      .then(() => (this.alertsCache = fresh))
      .catch((error: unknown) => this.logger.warn(`No se pudieron actualizar las alertas de ríos: ${(error as Error).message}`));
  }

  /**
   * Lee los pronósticos de los últimos días (uno por día, en serie para no
   * saturar el servicio) y mide cuán seguido alertó cada tramo. Los días que no
   * se publicaron o fallan se saltan. Mientras tanto las alertas salen sin marcar.
   */
  private async refreshPersistence(): Promise<void> {
    if (this.persistenceLoading) return;
    this.persistenceLoading = true;
    try {
      const history: RiverAlertsSnapshot[] = [];
      for (let back = 1; back <= PERSISTENCE_WINDOW_DAYS; back++) {
        const date = toEcuadorDate(new Date(Date.now() - back * DAY_MS));
        const snapshot = await this.alertSource.getAlertsOn(date).catch(() => null);
        if (snapshot) history.push(snapshot);
      }
      const value = alertPersistence(history);
      this.persistence = { value, computedAt: Date.now() };
      const persistent = [...value.shareByRiver.values()].filter((share) => share >= PERSISTENT_SHARE).length;
      this.logger.log(`Persistencia de alertas: ${value.forecasts} pronósticos, ${persistent} tramos persistentes`);
    } catch (error) {
      this.logger.warn(`No se pudo medir la persistencia de las alertas: ${(error as Error).message}`);
    } finally {
      this.persistenceLoading = false;
    }
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
