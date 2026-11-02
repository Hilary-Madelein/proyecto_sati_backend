import { isInsideRings, type Ring } from '../../common/geo/polygon.js';
import type { ParishAlert } from '../canton-analysis/canton-analysis.service.js';
import type { FlashFloodArea } from '../flood-hub/flood-hub-source.js';
import type { StationRain } from '../weather-stations/weather-stations.service.js';
import type { CantonForecast } from './flash-flood-cantons.js';

/** Hasta esta distancia, una estación representa la lluvia del lugar afectado. */
const STATION_RADIUS_KM = 10;
/** Con menos horas con dato, el total de la estación no representa la ventana. */
const MIN_STATION_HOURS = 6;
const EARTH_RADIUS_KM = 6371;
const RADIANS = Math.PI / 180;

export interface CantonRain {
  /** Lluvia pronosticada en 24 h: la más alta entre las parroquias afectadas. Null si no hay pronóstico. */
  forecastMm: number | null;
  /** Lluvia medida en las últimas 12 h por la estación más cercana, si hay una cerca. */
  measured: { mm: number; station: string; km: number } | null;
}

/** Distancia aproximada, suficiente a esta escala. */
function distanceKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const x = (lngB - lngA) * RADIANS * Math.cos(((latA + latB) / 2) * RADIANS);
  const y = (latB - latA) * RADIANS;
  return Math.hypot(x, y) * EARTH_RADIUS_KM;
}

/**
 * Agrega a cada cantón la lluvia de sus parroquias dentro de las zonas de Google.
 * El pronóstico se toma del punto de cada parroquia, sin promediar: la lluvia
 * intensa es puntual y es la misma lectura que usa la alerta por parroquia.
 */
export function withCantonRain<T extends CantonForecast>(
  cantons: readonly T[],
  zones: readonly FlashFloodArea[],
  parishes: readonly ParishAlert[],
  stations: readonly StationRain[],
): (T & { rain?: CantonRain })[] {
  const polygons = zones.flatMap((zone) => zone.geometry.coordinates as unknown as Ring[][]);
  const reporting = stations.filter(({ last12h }) => last12h.totalMm !== null && last12h.hoursWithData >= MIN_STATION_HOURS);

  return cantons.map((canton) => {
    const affected = parishes.filter(
      ({ cantonCode, point: [lat, lng] }) => cantonCode === canton.code && polygons.some((rings) => isInsideRings(rings, lng, lat)),
    );
    if (affected.length === 0) return canton;

    const forecasts = affected.map(({ forecast }) => forecast.mm24h).filter((mm) => mm !== null);
    let nearest: CantonRain['measured'] = null;
    for (const station of reporting) {
      for (const { point } of affected) {
        const km = distanceKm(station.lat, station.lng, point[0], point[1]);
        if (km <= STATION_RADIUS_KM && (!nearest || km < nearest.km)) nearest = { mm: station.last12h.totalMm!, station: station.name, km };
      }
    }
    return { ...canton, rain: { forecastMm: forecasts.length > 0 ? Math.max(...forecasts) : null, measured: nearest } };
  });
}
