import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../../common/async/map-with-concurrency.js';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { WeatherStationSource, type HourlyRain, type WeatherStation } from './weather-station-source.js';

const MINUTE_MS = 60 * 1000;
/** Pedidos simultáneos a la fuente al consultar todas las estaciones. */
const CONCURRENCY = 8;

export interface StationRain extends WeatherStation {
  /** Lluvia de cada hora reciente, de la más antigua a la más reciente. */
  hours: HourlyRain[];
  /** Suma de las horas con dato (mm); null si ninguna tiene dato. */
  totalMm: number | null;
  hoursWithData: number;
  /** Última hora con dato (ISO 8601). */
  lastTime: string | null;
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
 * Lluvia medida por las estaciones en las últimas horas. Consulta cada estación
 * que transmite y guarda el resultado unos minutos: la fuente publica un dato por hora.
 */
@Injectable()
export class WeatherStationsService {
  private readonly logger = new Logger(WeatherStationsService.name);
  private readonly stationsCache = new TtlCache<WeatherStation[]>(6 * 60 * MINUTE_MS, 1);
  private readonly snapshotCache = new TtlCache<WeatherStationsSnapshot>(10 * MINUTE_MS, 1);

  constructor(private readonly source: WeatherStationSource) {}

  async snapshot(): Promise<WeatherStationsSnapshot> {
    try {
      return await this.snapshotCache.get('latest', () => this.load());
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  private async load(): Promise<WeatherStationsSnapshot> {
    const all = await this.stationsCache.get('all', () => this.source.getStations());
    const transmitting = all.filter((station) => station.transmitting);

    let failed = 0;
    const stations = await mapWithConcurrency(transmitting, CONCURRENCY, async (station) => {
      // Una estación que no responde no impide mostrar las demás.
      const hours = await this.source.getRecentHourlyRain(station.id).catch(() => {
        failed++;
        return [];
      });
      return { ...station, hours, ...summarizeRain(hours) };
    });
    if (failed) this.logger.warn(`${failed} de ${transmitting.length} estaciones no respondieron`);

    return {
      updatedAt: new Date().toISOString(),
      attribution: this.source.attribution,
      windowHours: this.source.windowHours,
      stations,
    };
  }
}
