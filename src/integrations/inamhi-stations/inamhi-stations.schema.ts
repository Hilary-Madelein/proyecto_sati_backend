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

/**
 * Lluvia horaria. Desde el 25/10/2026 la API la entrega en `valor_1h` (antes, en
 * `1h`): se aceptan los dos nombres.
 */
export const hourlyResponseSchema = z.object({
  datos: z.array(
    z.object({
      fecha_toma_dato: z.string(),
      valor_1h: optionalAmount.optional(),
      '1h': optionalAmount.optional(),
    }),
  ),
});

/** Margen para decidir que una hora "está en el futuro" (relojes desfasados, dato recién publicado). */
const FUTURE_TOLERANCE_MS = 30 * 60 * 1000;

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
 * Lluvia de cada hora, ordenada. Hasta el 24/10/2026 la API marcaba con
 * "-05:00" horas que en realidad eran UTC (a las 08:55 de Ecuador ya entregaba
 * el dato "13:00-05:00"); desde el 25/10 la hora es la de Ecuador de verdad (a
 * las 07:40 el último dato es "07:00-05:00"). Se distingue por la respuesta
 * completa: si leída con su desfase la hora más reciente cae en el futuro, es
 * el formato viejo y las horas se leen tal cual, como UTC.
 */
export function toHourlyRain(response: z.infer<typeof hourlyResponseSchema>, now = Date.now()): HourlyRain[] {
  const readings = response.datos.flatMap((item) => {
    const wallTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.exec(item.fecha_toma_dato)?.[0];
    if (!wallTime) return [];
    const withOffset = Date.parse(item.fecha_toma_dato);
    const asUtc = Date.parse(`${wallTime}Z`);
    if (Number.isNaN(withOffset) || Number.isNaN(asUtc)) return [];
    return [{ withOffset, asUtc, mm: item.valor_1h ?? item['1h'] ?? null }];
  });
  const latest = Math.max(...readings.map((reading) => reading.withOffset));
  const mislabeledUtc = latest > now + FUTURE_TOLERANCE_MS;

  return readings
    .map((reading) => ({ time: new Date(mislabeledUtc ? reading.asUtc : reading.withOffset).toISOString(), mm: reading.mm }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
