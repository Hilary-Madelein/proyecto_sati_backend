import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { IocSeaLevelClient } from '../../integrations/ioc-sea-level/ioc-sea-level.client.js';
import { SEA_BASELINE_DAYS, SEA_STATION, readSea, type SeaReading } from './galapagos-sea.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_MS = 10 * 60 * 1000;
/** La primera carga espera a que el servidor termine de arrancar. */
const FIRST_RUN_DELAY_MS = 60 * 1000;
/** Al actualizar se vuelve a pedir un poco antes de la última lectura, por si llegó tarde. */
const OVERLAP_MS = 10 * 60 * 1000;

/**
 * Nivel del mar en Galápagos (mareógrafo de Santa Cruz). Guarda en memoria una
 * semana de lecturas, una por minuto, y las actualiza en segundo plano: la
 * consulta nunca espera a la red. La primera carga baja la semana día por día.
 */
@Injectable()
export class GalapagosSeaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GalapagosSeaService.name);
  private readonly levels = new Map<number, number>();
  private firstRun?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private refreshing: Promise<void> | null = null;

  constructor(private readonly client: IocSeaLevelClient) {}

  onApplicationBootstrap(): void {
    if (!this.client.enabled) return;
    this.firstRun = setTimeout(() => this.refreshInBackground(), FIRST_RUN_DELAY_MS);
    this.timer = setInterval(() => this.refreshInBackground(), REFRESH_MS);
  }

  onApplicationShutdown(): void {
    clearTimeout(this.firstRun);
    clearInterval(this.timer);
  }

  /** El mar ahora; null si aún no hay datos o son viejos. */
  current(now = new Date()): SeaReading | null {
    return readSea(
      Array.from(this.levels, ([time, level]) => ({ time, level })),
      now.getTime(),
    );
  }

  private refreshInBackground(): void {
    this.refreshing ??= this.refresh()
      .catch((error: unknown) => this.logger.warn(`No se pudo actualizar el nivel del mar: ${(error as Error).message}`))
      .finally(() => (this.refreshing = null));
  }

  /** Baja lo que falte hasta ahora, día por día, y descarta lo que tenga más de una semana. */
  async refresh(now = Date.now()): Promise<void> {
    const oldest = now - SEA_BASELINE_DAYS * DAY_MS;
    for (const time of this.levels.keys()) if (time < oldest) this.levels.delete(time);
    let latest = 0;
    for (const time of this.levels.keys()) latest = Math.max(latest, time);
    for (let from = Math.max(oldest, latest - OVERLAP_MS); from < now; from += DAY_MS) {
      const to = Math.min(from + DAY_MS, now);
      const readings = await this.client.readings(SEA_STATION.code, SEA_STATION.sensor, new Date(from), new Date(to));
      for (const { time, level } of readings) if (time >= oldest) this.levels.set(time, level);
    }
  }
}
