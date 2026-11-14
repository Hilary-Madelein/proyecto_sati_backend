import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { AppConfigService } from '../../config/app-config.service.js';

const SERVICE = 'Mareógrafos (IOC/UNESCO)';
const TIMEOUT_MS = 30_000;

/** Una lectura de un mareógrafo: el momento (ms) y el nivel (m) sobre la referencia propia del sensor. */
export interface SeaLevelReading {
  time: number;
  level: number;
}

interface IocRow {
  slevel?: number | string;
  stime?: string;
  sensor?: string;
}

/**
 * Nivel del mar medido por los mareógrafos de la red de la UNESCO (IOC Sea Level
 * Station Monitoring Facility): público, sin clave, una lectura por minuto. En
 * Ecuador los opera el INOCAR. Cada estación publica varios sensores, cada uno
 * con su propia referencia de altura: no se mezclan.
 */
@Injectable()
export class IocSeaLevelClient {
  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return Boolean(this.config.get('IOC_SEA_LEVEL_URL'));
  }

  /** Lecturas de un sensor de una estación entre dos momentos (como mucho, unos días por consulta). */
  async readings(code: string, sensor: string, from: Date, to: Date): Promise<SeaLevelReading[]> {
    const url = new URL(this.config.get('IOC_SEA_LEVEL_URL')!);
    url.search = new URLSearchParams({
      query: 'data',
      code,
      timestart: from.toISOString().slice(0, 16),
      timestop: to.toISOString().slice(0, 16),
      format: 'json',
    }).toString();
    const response = await fetchWithRetry(url, { service: SERVICE, timeoutMs: TIMEOUT_MS, retries: 1 });
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) return [];
    const readings: SeaLevelReading[] = [];
    for (const row of rows as IocRow[]) {
      if (row.sensor !== sensor || typeof row.stime !== 'string') continue;
      // "2026-11-14 14:41:00", en UTC.
      const time = Date.parse(`${row.stime.trim().slice(0, 19).replace(' ', 'T')}Z`);
      const level = Number(row.slevel);
      if (Number.isFinite(time) && Number.isFinite(level)) readings.push({ time, level });
    }
    return readings;
  }
}
