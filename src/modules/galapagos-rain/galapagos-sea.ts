import type { SeaLevelReading } from '../../integrations/ioc-sea-level/ioc-sea-level.client.js';
import type { GalapagosLevel } from './galapagos-rain.js';

/*
 * Matriz de decisión de Galápagos: lluvia × nivel del mar (acordada el 14/11/2026).
 *
 *                 mar bajo        mar alto
 *   baja lluvia   normal          precaución
 *   alta lluvia   alerta          emergencia
 *
 * - "Alta lluvia" es la alarma de lluvia de la estación (ver galapagos-rain.ts).
 * - La lluvia extrema es emergencia con cualquier marea: el desborde del 31 de
 *   octubre de 2026 empezó en plena bajamar (0,57 m bajo el nivel medio).
 * - "Mar alto" es el mar 0,50 m o más sobre su nivel medio, medido por el
 *   mareógrafo de Santa Cruz (Puerto Ayora, red IOC/UNESCO). Del 28/10 al
 *   14/11/2026 eso fue el 20 % de las horas; casi todas las pleamares lo alcanzan.
 * - Por eso la precaución (mar alto sin lluvia) pasa dos veces al día y no se
 *   avisa por Telegram: solo se muestra. Se avisa al llegar a alerta o emergencia.
 * - San Cristóbal no tiene mareógrafo en la red: usa el de Santa Cruz.
 *
 * Ojo: en esos 17 días ninguna alarma de lluvia coincidió con el mar alto, salvo
 * unas horas la tarde del 30 de octubre. El umbral del mar es un punto de partida.
 */

/** Mareógrafo de Santa Cruz en la red IOC y el sensor que se usa (radar). */
export const SEA_STATION = { code: 'sant', sensor: 'ras', place: 'Santa Cruz' } as const;
/** Mar alto: desde esta altura (m) sobre su nivel medio. */
export const HIGH_SEA_M = 0.5;
/** Días de lecturas con que se calcula el nivel medio. */
export const SEA_BASELINE_DAYS = 7;
/** Con menos lecturas que estas (un día, una por minuto) no hay nivel medio fiable. */
const MIN_BASELINE_READINGS = 1_000;
/** Una lectura a más de esto (m) del nivel medio no es marea: es un salto del sensor. */
const MAX_TIDE_M = 1.5;
/** El nivel de ahora es la mediana de los últimos minutos. */
const NOW_WINDOW_MS = 15 * 60 * 1000;
/** Si la última lectura es más vieja que esto, no se usa. */
const MAX_SEA_AGE_MS = 2 * 60 * 60 * 1000;

export interface SeaReading {
  /** Momento de la última lectura (ISO 8601). */
  time: string;
  /** Altura del mar (m) respecto de su nivel medio de los últimos días. */
  levelM: number;
  high: boolean;
  /** Dónde está el mareógrafo. */
  place: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** El mar ahora, a partir de las lecturas de los últimos días; null si no alcanzan o son viejas. */
export function readSea(readings: readonly SeaLevelReading[], now: number): SeaReading | null {
  if (readings.length < MIN_BASELINE_READINGS) return null;
  const center = median(readings.map(({ level }) => level));
  const valid = readings.filter(({ time, level }) => time <= now && Math.abs(level - center) <= MAX_TIDE_M);
  const last = valid.reduce((latest, { time }) => Math.max(latest, time), 0);
  if (now - last > MAX_SEA_AGE_MS) return null;
  const recent = valid.filter(({ time }) => time > last - NOW_WINDOW_MS).map(({ level }) => level);
  const levelM = Math.round((median(recent) - center) * 100) / 100;
  return { time: new Date(last).toISOString(), levelM, high: levelM >= HIGH_SEA_M, place: SEA_STATION.place };
}

export type GalapagosScenario = 'normal' | 'precaution' | 'alert' | 'emergency';
export const SCENARIO_RANK: Record<GalapagosScenario, number> = { normal: 0, precaution: 1, alert: 2, emergency: 3 };

/** La casilla de la matriz. Sin dato del mar decide solo la lluvia. */
export function scenarioOf(level: GalapagosLevel, sea: Pick<SeaReading, 'high'> | null): GalapagosScenario {
  if (level === 'extreme') return 'emergency';
  if (level === 'alarm') return sea?.high ? 'emergency' : 'alert';
  return sea?.high ? 'precaution' : 'normal';
}
