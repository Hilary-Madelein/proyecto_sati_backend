import { z } from 'zod';
import { toTitleCase } from '../../common/text/title-case.js';
import type { HourlyRain, StationCategory, WeatherStation } from '../../modules/weather-stations/weather-station-source.js';

/** Número o texto numérico; null si está vacío, no es un número o es negativo (sin dato). */
const optionalAmount = z.unknown().transform((value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
});

const CATEGORIES: Record<string, StationCategory> = {
  METEOROLOGICA: 'meteorological',
  HIDROLOGICA: 'hydrological',
  'HIDRO - METEOROLOGICA': 'hydrometeorological',
};

const stationSchema = z.object({
  id_estacion: z.number().int(),
  codigo: z.string(),
  punto_obs: z.string(),
  latitud: z.number().nullable(),
  longitud: z.number().nullable(),
  altitud: z.number().nullable().optional(),
  categoria: z.string(),
  estado_transmision: z.string().nullable().optional(),
});

export const stationsResponseSchema = z.object({ datos: z.array(stationSchema) });

export const hourlyResponseSchema = z.object({
  datos: z.array(
    z.object({
      fecha_toma_dato: z.string(),
      '1h': optionalAmount,
    }),
  ),
});

/** Cada parte separada por guion empieza con mayúscula: "QUITO AEROPUERTO- PARQUE BIC" → "Quito Aeropuerto - Parque Bic". */
function stationName(value: string): string {
  return value.split(/\s*-\s*/).map(toTitleCase).filter(Boolean).join(' - ');
}

/** Estaciones reales con coordenadas válidas, con nombres legibles ("LOJA - LA ARGELIA" → "Loja - La Argelia"). */
export function toWeatherStations(response: z.infer<typeof stationsResponseSchema>): WeatherStation[] {
  return response.datos.flatMap((station) => {
    if (station.latitud === null || station.longitud === null) return [];
    if (Math.abs(station.latitud) > 90 || Math.abs(station.longitud) > 180) return [];
    // Sin coordenadas reales (vienen en 0, 0) o de prueba ("Pruebas 1").
    if (station.latitud === 0 && station.longitud === 0) return [];
    if (/prueba/i.test(station.punto_obs)) return [];
    return [
      {
        id: station.id_estacion,
        code: station.codigo.trim(),
        name: stationName(station.punto_obs),
        lat: station.latitud,
        lng: station.longitud,
        altitude: station.altitud ?? null,
        category: CATEGORIES[station.categoria.trim().toUpperCase()] ?? 'meteorological',
        transmitting: station.estado_transmision?.trim().toUpperCase() === 'TRANSMITIENDO',
      },
    ];
  });
}

/**
 * Lluvia de cada hora, ordenada. La API marca las horas con "-05:00", pero la
 * hora que trae es UTC: a las 08:55 de Ecuador ya entrega el dato "13:00-05:00"
 * (comprobado el 13 de octubre de 2026). Se lee la hora tal cual, como UTC:
 * "2026-10-13T02:00:00-05:00" → "2026-10-13T02:00:00.000Z".
 */
export function toHourlyRain(response: z.infer<typeof hourlyResponseSchema>): HourlyRain[] {
  return response.datos
    .flatMap((item) => {
      const wallTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.exec(item.fecha_toma_dato)?.[0];
      const time = wallTime ? Date.parse(`${wallTime}Z`) : Number.NaN;
      return Number.isNaN(time) ? [] : [{ time: new Date(time).toISOString(), mm: item['1h'] }];
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}
