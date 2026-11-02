import {
  BadGatewayException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { mapWithConcurrency } from '../../common/async/map-with-concurrency.js';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { StationRainArchive, WeatherStationSource, type HourlyRain, type WeatherStation } from './weather-station-source.js';

const MINUTE_MS = 60 * 1000;
/** La fuente publica un dato por hora: se vuelve a consultar cada 10 minutos, en segundo plano. */
const REFRESH_MS = 10 * MINUTE_MS;
/** Pedidos simultáneos a la fuente al consultar todas las estaciones. */
const CONCURRENCY = 8;
const HOUR_MS = 60 * MINUTE_MS;
/** Horas que muestra la capa: lo reciente de la API y, antes, nuestro archivo. */
const WINDOW_HOURS = 24;
/** Ventana corta que siguen usando las alertas por Telegram ("ya medido en 12 h"). */
const RECENT_HOURS = 12;

export interface StationRain extends WeatherStation {
  /** Lluvia de cada hora reciente, de la más antigua a la más reciente. */
  hours: HourlyRain[];
  /** Suma de las horas con dato (mm); null si ninguna tiene dato. */
  totalMm: number | null;
  hoursWithData: number;
  /** Última hora con dato (ISO 8601). */
  lastTime: string | null;
  /** Total y horas con dato de las últimas 12 h. */
  last12h: { totalMm: number | null; hoursWithData: number };
}

export interface WeatherStationsSnapshot {
  updatedAt: string;
  attribution: string;
  windowHours: number;
  /** Estaciones que transmiten en tiempo real, con su lluvia reciente. */
  stations: StationRain[];
}

/** Total, horas con dato y última hora con dato de una serie horaria. */
export function summarizeRain(hours: readonly HourlyRain[]): Pick<StationRain, 'totalMm' | 'hoursWithData' | 'lastTime'> {
  const withData = hours.filter((hour) => hour.mm !== null);
  const total = withData.reduce((sum, hour) => sum + (hour.mm ?? 0), 0);
  return {
    totalMm: withData.length ? Math.round(total * 10) / 10 : null,
    hoursWithData: withData.length,
    lastTime: withData.at(-1)?.time ?? null,
  };
}

/**
 * Une el archivo con la API en una serie horaria dentro de (`since`, `until`]. En
 * la misma hora manda la API; el archivo solo completa lo que la API no trae.
 */
export function mergeRain(archived: readonly HourlyRain[], live: readonly HourlyRain[], since: number, until: number): HourlyRain[] {
  const byTime = new Map<string, number | null>();
  for (const { time, mm } of archived) byTime.set(time, mm);
  for (const { time, mm } of live) byTime.set(time, mm ?? byTime.get(time) ?? null);
  return [...byTime]
    .map(([time, mm]) => ({ time, mm }))
    .filter(({ time }) => {
      const at = Date.parse(time);
      return at > since && at <= until;
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Horas que de verdad cubren los datos: hasta donde llega el archivo, sin bajar de
 * lo que entrega la fuente ni pasar de la ventana. Así la capa no dice "24 h" si el
 * archivo aún no tiene lluvia de hace tantas horas.
 */
export function coveredHours(archived: ReadonlyMap<number, readonly HourlyRain[]>, until: number, minimum: number): number {
  const times = [...archived.values()].flat().map(({ time }) => Date.parse(time));
  if (times.length === 0) return minimum;
  return Math.min(WINDOW_HOURS, Math.max(minimum, Math.ceil((until - Math.min(...times)) / HOUR_MS)));
}

/**
 * Lluvia medida por las estaciones en las últimas horas. Consultar cada estación
 * que transmite puede tardar más de lo que espera el frontend (en el servidor
 * publicado pasó del minuto), así que se carga en segundo plano y se entrega
 * siempre la última carga buena, aunque tenga unos minutos.
 */
@Injectable()
export class WeatherStationsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WeatherStationsService.name);
  private readonly stationsCache = new TtlCache<WeatherStation[]>(6 * 60 * MINUTE_MS, 1);
  private latest: WeatherStationsSnapshot | null = null;
  private loading: Promise<WeatherStationsSnapshot> | null = null;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly source: WeatherStationSource,
    private readonly archive: StationRainArchive,
  ) {}

  onApplicationBootstrap(): void {
    this.refreshInBackground();
    this.refreshTimer = setInterval(() => this.refreshInBackground(), REFRESH_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  /** La última carga al instante; solo la primera consulta tras arrancar espera a la fuente. */
  async snapshot(): Promise<WeatherStationsSnapshot> {
    if (this.latest) {
      // Por si el temporizador no corrió (p. ej. el servidor estuvo dormido).
      if (Date.now() - Date.parse(this.latest.updatedAt) > REFRESH_MS) this.refreshInBackground();
      return this.latest;
    }
    try {
      return await this.refresh();
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  /** Una sola carga a la vez: las consultas que llegan mientras tanto esperan la misma. */
  private refresh(): Promise<WeatherStationsSnapshot> {
    this.loading ??= this.load()
      .then((snapshot) => (this.latest = snapshot))
      .finally(() => (this.loading = null));
    return this.loading;
  }

  private refreshInBackground(): void {
    this.refresh().catch((error: unknown) =>
      this.logger.warn(`No se pudo actualizar la lluvia de las estaciones: ${(error as Error).message}`),
    );
  }

  private async load(): Promise<WeatherStationsSnapshot> {
    const all = await this.stationsCache.get('all', () => this.source.getStations());
    const transmitting = all.filter((station) => station.transmitting);

    const until = Date.now();
    const since = until - WINDOW_HOURS * HOUR_MS;
    // Sin el archivo se sigue con lo que entrega la API, y la ventana lo dice.
    const archived = await this.archive.getHourlyRain(new Date(since), new Date(until)).catch((error: Error) => {
      this.logger.warn(`Sin archivo de lluvia, solo las últimas ${this.source.windowHours} h: ${error.message}`);
      return null;
    });

    let failed = 0;
    const stations = await mapWithConcurrency(transmitting, CONCURRENCY, async (station) => {
      // Una estación que no responde no impide mostrar las demás.
      const live = await this.source.getRecentHourlyRain(station.id).catch(() => {
        failed++;
        return [];
      });
      const hours = mergeRain(archived?.get(station.id) ?? [], live, since, until);
      const recent = summarizeRain(hours.filter(({ time }) => Date.parse(time) > until - RECENT_HOURS * HOUR_MS));
      return { ...station, hours, ...summarizeRain(hours), last12h: { totalMm: recent.totalMm, hoursWithData: recent.hoursWithData } };
    });
    if (failed) this.logger.warn(`${failed} de ${transmitting.length} estaciones no respondieron`);

    return {
      updatedAt: new Date().toISOString(),
      attribution: this.source.attribution,
      windowHours: archived ? coveredHours(archived, until, this.source.windowHours) : this.source.windowHours,
      stations,
    };
  }
}
