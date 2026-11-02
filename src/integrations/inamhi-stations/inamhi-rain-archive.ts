import { Injectable, Logger } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { StationRainArchive, type HourlyRain } from '../../modules/weather-stations/weather-station-source.js';

const SERVICE = 'Archivo de lluvia';
const TIMEOUT_MS = 20_000;
/** El archivo se actualiza cada pocas horas: no hace falta bajarlo en cada carga de las estaciones. */
const CACHE_MS = 30 * 60 * 1000;
const MAX_MONTHS_CACHED = 3;

/**
 * Lluvia por estación de las filas de un CSV del archivo
 * (`codigo,id_estacion,hora_utc,hora_ecuador,lluvia_mm`) dentro de (`since`, `until`].
 * Las horas vacías no aportan nada: entre el 22 de octubre y la corrección del
 * archivo (la API cambió de formato) se guardaron vacías y con la hora corrida.
 */
export function parseArchivedRain(csv: string, since: number, until: number): Map<number, HourlyRain[]> {
  const rows = new Map<number, HourlyRain[]>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [, id, hourUtc, , value] = line.split(',');
    const at = Date.parse(hourUtc ?? '');
    const station = Number(id);
    if (!Number.isInteger(station) || Number.isNaN(at) || at <= since || at > until) continue;
    const mm = value === undefined || value.trim() === '' ? Number.NaN : Number(value);
    if (Number.isNaN(mm)) continue;
    const row = { time: new Date(at).toISOString(), mm };
    const list = rows.get(station);
    if (list) list.push(row);
    else rows.set(station, [row]);
  }
  return rows;
}

/** Meses UTC (AAAA-MM) que toca el intervalo: el archivo guarda un CSV por mes. */
export function monthsBetween(since: Date, until: Date): string[] {
  const months: string[] = [];
  for (let at = Date.UTC(since.getUTCFullYear(), since.getUTCMonth()); at <= until.getTime(); ) {
    const date = new Date(at);
    months.push(date.toISOString().slice(0, 7));
    at = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Nuestro archivo de la lluvia horaria de las estaciones (sati-archivo-lluvia),
 * que un workflow actualiza cada pocas horas porque la API del INAMHI solo guarda
 * las últimas 12 h.
 */
@Injectable()
export class InamhiRainArchive extends StationRainArchive {
  private readonly logger = new Logger(InamhiRainArchive.name);
  private readonly files = new TtlCache<string>(CACHE_MS, MAX_MONTHS_CACHED);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getHourlyRain(since: Date, until: Date): Promise<Map<number, HourlyRain[]>> {
    const months = monthsBetween(since, until);
    const results = await Promise.allSettled(months.map((month) => this.files.get(month, () => this.download(month))));
    const files = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    // Un mes que aún no existe (el primero del mes, antes de la primera corrida) no invalida el otro.
    if (files.length === 0) throw (results[0] as PromiseRejectedResult).reason;
    if (files.length < months.length) this.logger.warn(`Faltan ${months.length - files.length} de ${months.length} meses del archivo de lluvia`);

    const rain = new Map<number, HourlyRain[]>();
    for (const file of files) {
      for (const [station, rows] of parseArchivedRain(file, since.getTime(), until.getTime())) {
        rain.set(station, [...(rain.get(station) ?? []), ...rows]);
      }
    }
    return rain;
  }

  private async download(month: string): Promise<string> {
    const url = `${this.config.get('INAMHI_RAIN_ARCHIVE_URL')}/${month}.csv`;
    return (await fetchWithRetry(url, { service: SERVICE, timeoutMs: TIMEOUT_MS, retries: 1 })).text();
  }
}
