import { Injectable, Logger } from '@nestjs/common';
import { StationRainArchive, type HourlyRain } from '../weather-stations/weather-station-source.js';
import { WeatherStationsService } from '../weather-stations/weather-stations.service.js';
import {
  ALARM_24H_LOADED_MM,
  ALARM_24H_MM,
  EXTREME_3H_MM,
  EXTREME_6H_MM,
  GALAPAGOS_STATIONS,
  LOADED_PRIOR_MM,
  PRIOR_HOURS,
  REFERENCE_EVENTS,
  accumulate,
  maxByDuration,
  readRain,
  type GalapagosStation,
  type RainReading,
} from './galapagos-rain.js';

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 24;

export interface GalapagosStationRain extends GalapagosStation, RainReading {
  /** Nombre de la estación en el INAMHI; null si hoy no transmite. */
  name: string | null;
  lat: number | null;
  lng: number | null;
  /** Lluvia de cada hora de las últimas 24 (mm; null sin dato) y su acumulado. */
  hours: Array<HourlyRain & { accumulatedMm: number }>;
  /** Lo máximo que llovió en 1, 2, 3… horas seguidas dentro de esas 24 (mm). */
  maxByDurationMm: number[];
}

export interface GalapagosRainSnapshot {
  updatedAt: string;
  attribution: string;
  stations: GalapagosStationRain[];
  /** Los dos episodios que sirven de bordes, con su lluvia máxima según la duración. */
  references: Array<{
    key: 'upper' | 'lower';
    label: string;
    island: string;
    date: string;
    outcome: string;
    totalMm: number;
    max3hMm: number;
    max6hMm: number;
    /** Lo máximo que llovió en 1, 2, 3… 24 horas seguidas (mm). */
    maxByDurationMm: number[];
  }>;
  thresholds: { alarm24hMm: number; alarm24hLoadedMm: number; loadedPriorMm: number; priorHours: number; extreme3hMm: number; extreme6hMm: number };
}

/**
 * Lluvia de las dos estaciones de Galápagos (M0191 en Santa Cruz y M0221 en San
 * Cristóbal) leída con sus propios umbrales: ver galapagos-rain.ts. Las últimas 24
 * horas salen de la carga de estaciones (API del INAMHI y nuestro archivo); la
 * lluvia de los tres días anteriores, del archivo.
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
    const until = now.getTime() - WINDOW_HOURS * HOUR_MS;
    // Sin el archivo no se sabe la lluvia previa: la alarma sigue con el umbral normal.
    const prior = await this.archive.getHourlyRain(new Date(until - PRIOR_HOURS * HOUR_MS), new Date(until)).catch((error: Error) => {
      this.logger.warn(`Sin lluvia previa de Galápagos: ${error.message}`);
      return null;
    });

    return {
      updatedAt: snapshot.updatedAt,
      attribution: snapshot.attribution,
      stations: GALAPAGOS_STATIONS.map((station) => {
        const live = snapshot.stations.find(({ code }) => code === station.code);
        const hours = live?.hours ?? [];
        const accumulated = accumulate(hours.map(({ mm }) => mm));
        return {
          ...station,
          name: live?.name ?? null,
          lat: live?.lat ?? null,
          lng: live?.lng ?? null,
          ...readRain(hours, prior && live ? (prior.get(live.id) ?? []) : null),
          hours: hours.map((hour, index) => ({ ...hour, accumulatedMm: accumulated[index] })),
          maxByDurationMm: maxByDuration(hours.map(({ mm }) => mm)),
        };
      }),
      references: REFERENCE_EVENTS.map(({ hourlyMm, ...event }) => ({ ...event, maxByDurationMm: maxByDuration(hourlyMm) })),
      thresholds: {
        alarm24hMm: ALARM_24H_MM,
        alarm24hLoadedMm: ALARM_24H_LOADED_MM,
        loadedPriorMm: LOADED_PRIOR_MM,
        priorHours: PRIOR_HOURS,
        extreme3hMm: EXTREME_3H_MM,
        extreme6hMm: EXTREME_6H_MM,
      },
    };
  }
}
