import type { HourlyRain } from '../weather-stations/weather-station-source.js';

/*
 * Alarma de lluvia solo para Galápagos, con las dos estaciones del INAMHI que
 * transmiten allá. No usa los umbrales generales del país, sino lo que pasó en esas
 * mismas estaciones (lluvia horaria validada del INAMHI, 28/10 al 13/11/2026):
 *
 * - Borde superior: Santa Cruz, 30 y 31 de octubre de 2026. 203,6 mm en 24 horas,
 *   con 96,6 mm en 3 horas y 136,7 mm en 6: se desbordó la cañada de La Cascada
 *   (1 fallecido, 2.760 afectados, cantón en emergencia).
 * - Borde inferior: San Cristóbal, 12 de noviembre de 2026. 160,7 mm en 24 horas,
 *   con 65,5 mm en 3 horas y 101,2 mm en 6: una vía inundada, sin afectados.
 *
 * San Cristóbal recibió el 30 y 31 de octubre más lluvia en 24 horas que Santa
 * Cruz (230 mm) pero repartida (59,6 mm en 3 horas): lo que separa el desastre de
 * lo demás es la intensidad en pocas horas, no el total del día. Y Santa Cruz
 * volvió a inundarse el 2 de noviembre con solo 66 mm en 24 horas, porque dos días
 * antes habían caído más de 200: la lluvia previa baja el umbral.
 *
 * Son tres episodios: los umbrales son un punto de partida, no una regla probada.
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

/** Alarma: lluvia acumulada en 24 horas (mm). */
export const ALARM_24H_MM = 100;
/** Con el suelo cargado, la alarma salta con la mitad. */
export const ALARM_24H_LOADED_MM = 50;
/** Suelo cargado: esta lluvia (mm) en las 72 horas anteriores a las últimas 24. */
export const LOADED_PRIOR_MM = 100;
export const PRIOR_HOURS = 72;
/**
 * Alarma extrema: la intensidad pasa del borde inferior (65,5 mm en 3 h; 101,2 en
 * 6 h) y va hacia el superior (96,6 y 136,7).
 */
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
  /** Lluvia de cada una de sus 24 horas más lluviosas (mm). */
  hourlyMm: readonly number[];
  totalMm: number;
  max3hMm: number;
  max6hMm: number;
}

export const REFERENCE_EVENTS: readonly ReferenceEvent[] = [
  {
    key: 'upper',
    label: 'Borde superior',
    island: 'Santa Cruz',
    date: '30 y 31 de octubre de 2026',
    outcome: 'se desbordó la cañada de La Cascada: 1 fallecido y 2.760 afectados',
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
    hourlyMm: [13.7, 5.4, 7.6, 3.0, 0.4, 0.3, 0.4, 0.4, 0.1, 0.3, 0.0, 7.9, 1.8, 7.7, 5.3, 20.3, 7.6, 10.7, 12.7, 42.1, 7.8, 2.4, 0.9, 1.9],
    totalMm: 160.7,
    max3hMm: 65.5,
    max6hMm: 101.2,
  },
];

const HOUR_MS = 60 * 60 * 1000;
const round1 = (value: number) => Math.round(value * 10) / 10;
/** Cifra para un texto: con coma decimal. */
const text = (value: number | null) => String(value ?? 0).replace('.', ',');

export interface RainReading {
  /** Última hora con dato (ISO 8601); null si la estación no tiene datos en la ventana. */
  lastTime: string | null;
  hoursWithData: number;
  /** Acumulado hasta la última hora con dato (mm). */
  mm1h: number;
  mm3h: number;
  mm6h: number;
  mm12h: number;
  mm24h: number;
  /** Lluvia de las 72 horas anteriores a esas 24; null si no se pudo leer el archivo. */
  priorMm: number | null;
  /** El suelo ya venía cargado: baja el umbral de la alarma. */
  loaded: boolean;
  /** Umbral de 24 horas que rige ahora (mm). */
  alarmThresholdMm: number;
  level: GalapagosLevel;
  /** Por qué está en ese nivel, en una frase; null en normal. */
  reason: string | null;
}

/**
 * Lee la lluvia de una estación: los acumulados hasta su última hora con dato, la
 * lluvia previa y el nivel. `hours` son las últimas 24 horas; `prior`, las 72
 * anteriores (null si no se pudieron leer: entonces no se baja el umbral).
 */
export function readRain(hours: readonly HourlyRain[], prior: readonly HourlyRain[] | null): RainReading {
  const withData = hours.filter((hour): hour is { time: string; mm: number } => hour.mm !== null);
  const last = withData.at(-1);
  const end = last ? Date.parse(last.time) : 0;
  const sum = (window: number) => round1(withData.filter(({ time }) => Date.parse(time) > end - window * HOUR_MS).reduce((total, { mm }) => total + mm, 0));
  const priorMm = prior ? round1(prior.reduce((total, { mm }) => total + (mm ?? 0), 0)) : null;
  const loaded = priorMm !== null && priorMm >= LOADED_PRIOR_MM;
  const alarmThresholdMm = loaded ? ALARM_24H_LOADED_MM : ALARM_24H_MM;
  const [mm1h, mm3h, mm6h, mm12h, mm24h] = [sum(1), sum(3), sum(6), sum(12), sum(24)];

  let level: GalapagosLevel = 'normal';
  let reason: string | null = null;
  if (mm3h >= EXTREME_3H_MM || mm6h >= EXTREME_6H_MM) {
    level = 'extreme';
    reason =
      mm3h >= EXTREME_3H_MM
        ? `${text(mm3h)} mm en 3 horas: más que el 12 de noviembre en San Cristóbal (65,5 mm) y camino a lo del 30 de octubre en Santa Cruz (96,6 mm)`
        : `${text(mm6h)} mm en 6 horas: más que el 12 de noviembre en San Cristóbal (101,2 mm) y camino a lo del 30 de octubre en Santa Cruz (136,7 mm)`;
  } else if (mm24h >= alarmThresholdMm) {
    level = 'alarm';
    reason = loaded
      ? `${text(mm24h)} mm en 24 horas sobre un suelo cargado (${text(priorMm)} mm en los tres días anteriores): con lluvia previa, el umbral baja a ${ALARM_24H_LOADED_MM} mm`
      : `${text(mm24h)} mm en 24 horas: pasa el umbral de ${ALARM_24H_MM} mm`;
  }
  return { lastTime: last?.time ?? null, hoursWithData: withData.length, mm1h, mm3h, mm6h, mm12h, mm24h, priorMm, loaded, alarmThresholdMm, level, reason };
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
