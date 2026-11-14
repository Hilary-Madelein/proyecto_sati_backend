import type { HourlyRain } from '../weather-stations/weather-station-source.js';

/*
 * Alarma de lluvia solo para Galápagos, con las dos estaciones del INAMHI que
 * transmiten allá. No usa los umbrales generales del país, sino lo que pasó en esas
 * mismas estaciones (lluvia horaria validada del INAMHI, 28/10 al 13/11/2026).
 *
 * Los dos límites de referencia son de Santa Cruz:
 * - Límite superior: 30 y 31 de octubre de 2026. 229 mm en dos días, con 96,6 mm en
 *   3 horas y 136,7 mm en 6: se desbordó la cañada de La Cascada (1 fallecido,
 *   2.760 afectados, cantón en emergencia).
 * - Límite inferior: 11 y 12 de noviembre de 2026. 30 mm en dos días, en chubascos
 *   cortos y separados, tras una semana casi seca: sin inundación reportada.
 *
 * La alarma (regla acordada con el equipo el 13/11/2026) salta con unos 25 mm en 5
 * horas, o cuando a una tanda de unos 15 mm le sigue, tras una pausa, otra parecida.
 * Con esos mismos 17 días de datos habría saltado 7 veces entre las dos estaciones;
 * en Santa Cruz, el 30 de octubre a las 16:00 (nueve horas antes del desborde) y el
 * 2 de noviembre a las 08:00 (antes de que la cañada se desbordara otra vez), y no
 * el 12 de noviembre. La alarma extrema avisa cuando la intensidad va hacia la del
 * límite superior.
 *
 * Son pocos episodios: los umbrales son un punto de partida, no una regla probada.
 */

export interface GalapagosStation {
  /** Código del INAMHI. */
  code: string;
  island: string;
  place: string;
  /** Código DPA del cantón, para saber a quién avisar. */
  cantonCode: string;
}

export const GALAPAGOS_STATIONS: readonly GalapagosStation[] = [
  { code: 'M0191', island: 'Santa Cruz', place: 'Puerto Ayora', cantonCode: '2003' },
  { code: 'M0221', island: 'San Cristóbal', place: 'Puerto Baquerizo Moreno', cantonCode: '2001' },
];

export const GALAPAGOS_PROVINCE = 'Galápagos';

/** Alarma: lluvia acumulada en 5 horas (mm). */
export const ALARM_5H_MM = 25;
/** Alarma: dos tandas de al menos esta lluvia (mm) separadas por una pausa. */
export const ALARM_BURST_MM = 15;
/** Una hora cuenta como lluvia desde este valor (mm); por debajo es pausa. */
export const WET_HOUR_MM = 1;
/** Horas hacia atrás en que se buscan las dos tandas. */
export const BURST_LOOKBACK_HOURS = 12;
/** Alarma extrema: la intensidad va hacia la del límite superior (96,6 mm en 3 h; 136,7 en 6 h). */
export const EXTREME_3H_MM = 70;
export const EXTREME_6H_MM = 110;

export type GalapagosLevel = 'normal' | 'alarm' | 'extreme';
export const LEVEL_RANK: Record<GalapagosLevel, number> = { normal: 0, alarm: 1, extreme: 2 };

export interface ReferenceEvent {
  key: 'upper' | 'lower';
  label: string;
  island: string;
  date: string;
  outcome: string;
  /** Para la leyenda de la gráfica, en pocas palabras. */
  shortLabel: string;
  /** Lluvia de cada una de sus 24 horas más lluviosas (mm). */
  hourlyMm: readonly number[];
  totalMm: number;
  max3hMm: number;
  max6hMm: number;
}

/** Episodios de referencia para la comparación por duración (popup de San Cristóbal). */
export const REFERENCE_EVENTS: readonly ReferenceEvent[] = [
  {
    key: 'upper',
    label: 'Borde superior',
    island: 'Santa Cruz',
    date: '30 y 31 de octubre de 2026',
    outcome: 'se desbordó la cañada de La Cascada: 1 fallecido y 2.760 afectados',
    shortLabel: 'Santa Cruz, 30-31 oct (desborde)',
    hourlyMm: [0.1, 1.4, 5.7, 3.0, 1.1, 0.8, 1.0, 0.6, 0.0, 0.8, 0.4, 0.0, 24.0, 20.6, 1.5, 0.4, 5.2, 0.3, 24.7, 24.9, 36.8, 34.9, 13.8, 1.6],
    totalMm: 203.6,
    max3hMm: 96.6,
    max6hMm: 136.7,
  },
  {
    key: 'lower',
    label: 'Borde inferior',
    island: 'San Cristóbal',
    date: '12 de noviembre de 2026',
    outcome: 'se inundó una vía, sin afectados',
    shortLabel: 'San Cristóbal, 12 nov (vía inundada)',
    hourlyMm: [13.7, 5.4, 7.6, 3.0, 0.4, 0.3, 0.4, 0.4, 0.1, 0.3, 0.0, 7.9, 1.8, 7.7, 5.3, 20.3, 7.6, 10.7, 12.7, 42.1, 7.8, 2.4, 0.9, 1.9],
    totalMm: 160.7,
    max3hMm: 65.5,
    max6hMm: 101.2,
  },
];

export interface TwoDayLimit {
  key: 'upper' | 'lower';
  /** Para la leyenda de la gráfica. */
  label: string;
  /** Lluvia de cada una de las 48 horas de sus dos días, desde las 00:00 del primero (mm). */
  hourlyMm: readonly number[];
}

/**
 * Los dos límites de Santa Cruz para la gráfica de dos días: la lluvia de cada hora
 * de los dos días de cada episodio, con las horas del registro del INAMHI.
 */
export const TWO_DAY_LIMITS: readonly TwoDayLimit[] = [
  {
    key: 'upper',
    label: 'Límite superior: 30-31 oct, desborde',
    hourlyMm: [
      0.0, 0.0, 2.0, 0.0, 0.1, 1.4, 5.7, 3.0, 1.1, 0.8, 1.0, 0.6, 0.0, 0.8, 0.4, 0.0, 24.0, 20.6, 1.5, 0.4, 5.2, 0.3, 24.7, 24.9,
      36.8, 34.9, 13.8, 1.6, 0.1, 0.0, 0.0, 0.0, 0.2, 0.0, 0.3, 0.0, 0.0, 0.1, 7.6, 4.1, 1.2, 0.8, 1.3, 0.1, 5.4, 2.2, 0.0, 0.0,
    ],
  },
  {
    key: 'lower',
    label: 'Límite inferior: 11-12 nov',
    hourlyMm: [
      1.7, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
      0.0, 0.0, 0.0, 0.0, 0.0, 1.3, 11.3, 0.7, 0.0, 0.0, 8.0, 3.2, 0.8, 0.0, 0.0, 0.0, 1.5, 1.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
  },
];

const HOUR_MS = 60 * 60 * 1000;
/** El registro del INAMHI cuenta los días en hora del continente (UTC-5). */
const RECORD_OFFSET_MS = 5 * HOUR_MS;
const round1 = (value: number) => Math.round(value * 10) / 10;
/** Cifra para un texto: con coma decimal. */
const text = (value: number) => String(value).replace('.', ',');

/** Las 00:00 de ayer (día del registro) respecto de `now`, en milisegundos: desde ahí se cuenta la gráfica de dos días. */
export function twoDayStart(now: number): number {
  const DAY_MS = 24 * HOUR_MS;
  return Math.floor((now - RECORD_OFFSET_MS) / DAY_MS) * DAY_MS - DAY_MS + RECORD_OFFSET_MS;
}

export interface RainReading {
  /** Última hora con dato (ISO 8601); null si la estación no tiene datos en la ventana. */
  lastTime: string | null;
  hoursWithData: number;
  /** Acumulado hasta la última hora con dato (mm). */
  mm1h: number;
  mm3h: number;
  mm5h: number;
  mm6h: number;
  mm24h: number;
  level: GalapagosLevel;
  /** Por qué está en ese nivel, en una frase; null en normal. */
  reason: string | null;
}

/**
 * Tandas de lluvia (horas seguidas con `WET_HOUR_MM` o más) de las últimas
 * `BURST_LOOKBACK_HOURS` horas hasta `end`, de la más antigua a la más reciente:
 * los mm de cada una.
 */
export function rainBursts(byTime: ReadonlyMap<number, number>, end: number): number[] {
  const bursts: number[] = [];
  let current = 0;
  for (let hour = BURST_LOOKBACK_HOURS - 1; hour >= 0; hour--) {
    const mm = byTime.get(end - hour * HOUR_MS) ?? 0;
    if (mm >= WET_HOUR_MM) current += mm;
    else if (current > 0) {
      bursts.push(round1(current));
      current = 0;
    }
  }
  if (current > 0) bursts.push(round1(current));
  return bursts;
}

/**
 * Lee la lluvia de una estación: los acumulados hasta su última hora con dato y el
 * nivel. `hours` son las horas recientes (al menos las últimas 24).
 */
export function readRain(hours: readonly HourlyRain[]): RainReading {
  const withData = hours.filter((hour): hour is { time: string; mm: number } => hour.mm !== null);
  const byTime = new Map(withData.map(({ time, mm }) => [Date.parse(time), mm]));
  const last = withData.at(-1);
  const end = last ? Date.parse(last.time) : 0;
  const sum = (window: number) => {
    let total = 0;
    for (let hour = 0; hour < window; hour++) total += byTime.get(end - hour * HOUR_MS) ?? 0;
    return round1(total);
  };
  const [mm1h, mm3h, mm5h, mm6h, mm24h] = [sum(1), sum(3), sum(5), sum(6), sum(24)];
  const bursts = rainBursts(byTime, end);
  // La tanda en curso y alguna anterior, las dos de unos 15 mm: llovió, paró y volvió a llover parecido.
  const raining = mm1h >= WET_HOUR_MM;
  const earlier = bursts.slice(0, -1).filter((mm) => mm >= ALARM_BURST_MM);
  const second = raining && bursts.length >= 2 && bursts.at(-1)! >= ALARM_BURST_MM && earlier.length > 0;

  let level: GalapagosLevel = 'normal';
  let reason: string | null = null;
  if (mm3h >= EXTREME_3H_MM) {
    level = 'extreme';
    reason = `${text(mm3h)} mm en 3 horas (en el desborde del 30 de octubre fueron 96,6)`;
  } else if (mm6h >= EXTREME_6H_MM) {
    level = 'extreme';
    reason = `${text(mm6h)} mm en 6 horas (en el desborde del 30 de octubre fueron 136,7)`;
  } else if (mm5h >= ALARM_5H_MM) {
    level = 'alarm';
    reason = `${text(mm5h)} mm en 5 horas`;
  } else if (second) {
    level = 'alarm';
    reason = `dos tandas de lluvia con una pausa entre ellas: ${text(Math.max(...earlier))} mm y ${text(bursts.at(-1)!)} mm`;
  }
  return { lastTime: last?.time ?? null, hoursWithData: withData.length, mm1h, mm3h, mm5h, mm6h, mm24h, level, reason };
}

/**
 * Lo máximo que llovió (mm) en cualquier ventana de 1, 2, 3… horas seguidas de la
 * serie: la intensidad según la duración. Es la forma de comparar episodios sin
 * tener que alinear sus horas, y siempre sube con la duración.
 */
export function maxByDuration(hourlyMm: readonly (number | null)[]): number[] {
  const values = hourlyMm.map((mm) => mm ?? 0);
  return values.map((_, index) => {
    const duration = index + 1;
    let best = 0;
    for (let start = 0; start + duration <= values.length; start++) {
      let total = 0;
      for (let hour = start; hour < start + duration; hour++) total += values[hour];
      best = Math.max(best, total);
    }
    return round1(best);
  });
}

/** Curva de lluvia acumulada (mm) de una serie horaria: un punto por hora. */
export function accumulate(hourlyMm: readonly (number | null)[]): number[] {
  let total = 0;
  return hourlyMm.map((mm) => round1((total += mm ?? 0)));
}
