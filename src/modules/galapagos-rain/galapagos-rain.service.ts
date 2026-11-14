import { Injectable, Logger } from '@nestjs/common';
import { StationRainArchive, type HourlyRain } from '../weather-stations/weather-station-source.js';
import { WeatherStationsService } from '../weather-stations/weather-stations.service.js';
import {
  ALARM_5H_MM,
  ALARM_BURST_MM,
  EXTREME_3H_MM,
  EXTREME_6H_MM,
  GALAPAGOS_STATIONS,
  REFERENCE_EVENTS,
  TWO_DAY_LIMITS,
  accumulate,
  maxByDuration,
  readRain,
  twoDayStart,
  type GalapagosStation,
  type RainReading,
} from './galapagos-rain.js';

const HOUR_MS = 60 * 60 * 1000;
/** Horas que entrega la carga de estaciones; lo anterior sale del archivo. */
const RECENT_HOURS = 24;
/** La gráfica de dos días empieza a las 00:00 de ayer: como mucho, 48 horas atrás. */
const TWO_DAYS_HOURS = 48;

export interface GalapagosStationRain extends GalapagosStation, RainReading {
  /** Nombre de la estación en el INAMHI; null si hoy no transmite. */
  name: string | null;
  lat: number | null;
  lng: number | null;
  /** Lo máximo que llovió en 1, 2, 3… horas seguidas dentro de las últimas 24 (mm). */
  maxByDurationMm: number[];
  /**
   * "Aquí estamos": la lluvia acumulada desde las 00:00 de ayer (día del registro)
   * hasta la última hora con dato. `hour` es la hora transcurrida desde ese inicio (1 a 48).
   */
  twoDays: Array<{ hour: number; time: string; accumulatedMm: number }>;
}

export interface GalapagosRainSnapshot {
  updatedAt: string;
  attribution: string;
  /** Las 00:00 de ayer (ISO 8601): el inicio de la gráfica de dos días. */
  twoDaysFrom: string;
  stations: GalapagosStationRain[];
  /** Los dos límites de Santa Cruz, con su lluvia acumulada en cada una de las 48 horas de sus dos días. */
  limits: Array<{ key: 'upper' | 'lower'; label: string; totalMm: number; accumulatedMm: number[] }>;
  /** Los episodios de la comparación por duración, con su lluvia máxima según la duración. */
  references: Array<{
    key: 'upper' | 'lower';
    label: string;
    island: string;
    date: string;
    outcome: string;
    shortLabel: string;
    totalMm: number;
    max3hMm: number;
    max6hMm: number;
    /** Lo máximo que llovió en 1, 2, 3… 24 horas seguidas (mm). */
    maxByDurationMm: number[];
  }>;
  thresholds: { alarm5hMm: number; alarmBurstMm: number; extreme3hMm: number; extreme6hMm: number };
}

/**
 * Lluvia de las dos estaciones de Galápagos (M0191 en Santa Cruz y M0221 en San
 * Cristóbal) leída con sus propios umbrales: ver galapagos-rain.ts. Las últimas 24
 * horas salen de la carga de estaciones (API del INAMHI y nuestro archivo); lo
 * anterior, hasta las 00:00 de ayer, del archivo.
 */
@Injectable()
export class GalapagosRainService {
  private readonly logger = new Logger(GalapagosRainService.name);

  constructor(
    private readonly stations: WeatherStationsService,
    private readonly archive: StationRainArchive,
  ) {}

  async snapshot(now = new Date()): Promise<GalapagosRainSnapshot> {
    const snapshot = await this.stations.snapshot();
    const start = twoDayStart(now.getTime());
    const recentFrom = now.getTime() - RECENT_HOURS * HOUR_MS;
    // Sin el archivo, la curva de dos días empieza donde empiezan los datos recientes.
    const older = await this.archive.getHourlyRain(new Date(now.getTime() - TWO_DAYS_HOURS * HOUR_MS), new Date(recentFrom)).catch((error: Error) => {
      this.logger.warn(`Sin el archivo de lluvia para Galápagos: ${error.message}`);
      return null;
    });

    return {
      updatedAt: snapshot.updatedAt,
      attribution: snapshot.attribution,
      twoDaysFrom: new Date(start).toISOString(),
      stations: GALAPAGOS_STATIONS.map((station) => {
        const live = snapshot.stations.find(({ code }) => code === station.code);
        const recent = live?.hours ?? [];
        const all: HourlyRain[] = [...(live ? (older?.get(live.id) ?? []) : []), ...recent];
        const reading = readRain(recent);
        const end = reading.lastTime ? Date.parse(reading.lastTime) : start;
        // Desde las 00:00 de ayer hasta la última hora con dato, hora por hora (las que falten cuentan cero).
        const byTime = new Map(all.map(({ time, mm }) => [Date.parse(time), mm ?? 0]));
        const hours = Math.max(0, Math.min(TWO_DAYS_HOURS, Math.round((end - start) / HOUR_MS)));
        const times = Array.from({ length: hours }, (_, index) => start + (index + 1) * HOUR_MS);
        const accumulated = accumulate(times.map((time) => byTime.get(time) ?? 0));
        return {
          ...station,
          name: live?.name ?? null,
          lat: live?.lat ?? null,
          lng: live?.lng ?? null,
          ...reading,
          maxByDurationMm: maxByDuration(recent.map(({ mm }) => mm)),
          twoDays: times.map((time, index) => ({ hour: index + 1, time: new Date(time).toISOString(), accumulatedMm: accumulated[index] })),
        };
      }),
      limits: TWO_DAY_LIMITS.map(({ key, label, hourlyMm }) => {
        const accumulated = accumulate(hourlyMm);
        return { key, label, totalMm: accumulated.at(-1) ?? 0, accumulatedMm: accumulated };
      }),
      references: REFERENCE_EVENTS.map(({ hourlyMm, ...event }) => ({ ...event, maxByDurationMm: maxByDuration(hourlyMm) })),
      thresholds: { alarm5hMm: ALARM_5H_MM, alarmBurstMm: ALARM_BURST_MM, extreme3hMm: EXTREME_3H_MM, extreme6hMm: EXTREME_6H_MM },
    };
  }
}
