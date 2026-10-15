import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import {
  WeatherStationSource,
  type HourlyRain,
  type WeatherStation,
} from '../../modules/weather-stations/weather-station-source.js';
import { hourlyResponseSchema, stationsResponseSchema, toHourlyRain, toWeatherStations } from './inamhi-stations.schema.js';

const SERVICE = 'Estaciones INAMHI';
/** Nemónico de la lluvia horaria (mm) en la API del INAMHI. */
const HOURLY_RAIN = '017140801h';
/** Estaciones con datos por API (las demás son manuales y no informan en tiempo real). */
const CAPTORS = 'ELECTROMECANICA';
/** Responde en menos de 1 s; una estación colgada no debe frenar la carga de todas. */
const TIMEOUT_MS = 10_000;

/**
 * API pública del INAMHI (apis.inamhi.gob.ec): estaciones con coordenadas y
 * lluvia de cada hora. Solo entrega las últimas 12 h: el historial lo guarda el
 * repositorio de archivo (sati-archivo-lluvia).
 */
@Injectable()
export class InamhiStationSource extends WeatherStationSource {
  readonly attribution = 'Estaciones: INAMHI';
  readonly windowHours = 12;

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getStations(): Promise<WeatherStation[]> {
    const url = this.url('estaciones/');
    url.searchParams.set('captores', CAPTORS);
    const parsed = stationsResponseSchema.safeParse(await this.json(url));
    if (!parsed.success) throw new UpstreamError(SERVICE, 'respondió la lista de estaciones con un formato inesperado');
    return toWeatherStations(parsed.data);
  }

  async getRecentHourlyRain(stationId: number): Promise<HourlyRain[]> {
    const url = this.url('datos/horarios/');
    url.searchParams.set('id_estacion', String(stationId));
    url.searchParams.set('nemonico', HOURLY_RAIN);
    const parsed = hourlyResponseSchema.safeParse(await this.json(url));
    if (!parsed.success) throw new UpstreamError(SERVICE, `respondió la estación ${stationId} con un formato inesperado`);
    return toHourlyRain(parsed.data);
  }

  private url(path: string): URL {
    const base = this.config.get('INAMHI_STATIONS_API_URL');
    return new URL(path, base.endsWith('/') ? base : `${base}/`);
  }

  private async json(url: URL): Promise<unknown> {
    return (await fetchWithRetry(url, { service: SERVICE, timeoutMs: TIMEOUT_MS, retries: 1 })).json();
  }
}
