/*
 * Episodios anteriores de El Niño, para dar proporción cuando se prevé una lluvia
 * excepcional. Solo se compara lo que el sistema puede sostener con una fuente:
 *
 * - El calentamiento del mar frente a Ecuador y Perú (región Niño 1+2): anomalía
 *   mensual más alta de cada episodio, del índice OISST de la NOAA
 *   (https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices, consultado el 13/11/2026).
 * - Los daños en Ecuador: CEPAL (1982-1983: unos 640 millones de dólares;
 *   1997-1998: unos 2.870 millones) y Defensa Civil (292 fallecidos en 1997-1998).
 *
 * No hay en el sistema registros de lluvia diaria de esos años: los mm de hoy no se
 * comparan con los de entonces.
 */
export interface PastNino {
  evento: string;
  /** Anomalía mensual más alta del mar en la región Niño 1+2 (°C). */
  picoDelCalentamientoDelMarC: number;
  mesDelPico: string;
  /** Daños documentados en Ecuador; no todos los episodios tienen una cifra con fuente. */
  daniosEnEcuador?: string;
}

export const PAST_NINOS: readonly PastNino[] = [
  { evento: 'El Niño de 1982-1983', picoDelCalentamientoDelMarC: 4, mesDelPico: 'junio de 1983', daniosEnEcuador: 'unos 640 millones de dólares en daños, según la CEPAL' },
  {
    evento: 'El Niño de 1997-1998',
    picoDelCalentamientoDelMarC: 3.7,
    mesDelPico: 'noviembre y diciembre de 1997',
    daniosEnEcuador: 'unos 2.870 millones de dólares en daños, según la CEPAL, y 292 fallecidos, según la Defensa Civil',
  },
  { evento: 'El Niño de 2015-2016', picoDelCalentamientoDelMarC: 2.5, mesDelPico: 'julio de 2015' },
  { evento: 'El Niño de 2023-2024', picoDelCalentamientoDelMarC: 3.3, mesDelPico: 'agosto de 2023' },
];

/** Lluvia de 24 h desde la que el pronóstico se compara con los episodios anteriores (el umbral de lluvia torrencial del día). */
export const EXCEPTIONAL_RAIN_24H_MM = 100;

/** Cómo queda el mar de hoy frente a los picos anteriores; null si no se conoce la anomalía de hoy. */
export function seaReading(todayC: number | null): string | null {
  if (todayC === null) return null;
  const hotter = PAST_NINOS.filter((nino) => todayC > nino.picoDelCalentamientoDelMarC).length;
  if (hotter === PAST_NINOS.length) return 'el mar frente a Ecuador está hoy más caliente que en el mes más cálido de todos esos episodios';
  if (hotter === 0) return 'el mar frente a Ecuador está hoy menos caliente que en el mes más cálido de todos esos episodios';
  return `el mar frente a Ecuador está hoy más caliente que en el mes más cálido de ${hotter} de esos ${PAST_NINOS.length} episodios`;
}
