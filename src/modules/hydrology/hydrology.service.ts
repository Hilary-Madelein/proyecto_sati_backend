import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { RiverAlert, RiverAlertsSnapshot, RiverForecast } from './domain/river.js';
import { RiverAlertSource, RiverForecastSource } from './river-sources.js';

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

  constructor(
    private readonly forecasts: RiverForecastSource,
    private readonly alertSource: RiverAlertSource,
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
