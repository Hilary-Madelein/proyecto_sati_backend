/** Color del semáforo por lluvia pronosticada, los cuatro del documento. */
export type Semaphore = 'green' | 'yellow' | 'orange' | 'red';

export type RainCategory = 'minima' | 'ligera' | 'moderada' | 'fuerte' | 'intensa' | 'torrencial' | 'extrema';

export interface Band {
  category: RainCategory;
  label: string;
  /** Lluvia de cada ventana desde la que empieza la categoría (mm). */
  from3h: number;
  from6h: number;
  from12h: number;
  from24h: number;
  semaphore: Semaphore;
  consequences: string;
  actions: string;
}

/**
 * Umbrales de lluvia, consecuencias y acciones del documento "Lluvia de 12 horas"
 * (25/10/2026), de menor a mayor, con los colores del documento: verde hasta
 * ligera, amarillo moderada y fuerte, naranja intensa y rojo desde torrencial.
 * Los de 3 y 6 h se agregaron después (tabla del equipo, noviembre 2026): cada
 * límite inferior es inclusivo y el superior, exclusivo.
 */
export const RAIN_BANDS: readonly Band[] = [
  {
    category: 'minima',
    label: 'Mínima',
    from3h: 0,
    from6h: 0,
    from12h: 0,
    from24h: 0,
    semaphore: 'green',
    consequences: 'Sin impactos significativos por lluvia nueva.',
    actions: 'Monitoreo rutinario.',
  },
  {
    category: 'ligera',
    label: 'Ligera',
    from3h: 0.1,
    from6h: 0.1,
    from12h: 0.1,
    from24h: 0.1,
    semaphore: 'green',
    consequences: 'Escorrentía superficial limitada.',
    actions: 'Seguimiento meteorológico habitual.',
  },
  {
    category: 'moderada',
    label: 'Moderada',
    from3h: 2,
    from6h: 3,
    from12h: 5,
    from24h: 10,
    semaphore: 'yellow',
    consequences: 'Encharcamientos localizados y posibles problemas de drenaje.',
    actions: 'Vigilar zonas bajas y sistemas de drenaje.',
  },
  {
    category: 'fuerte',
    label: 'Fuerte',
    from3h: 5,
    from6h: 10,
    from12h: 15,
    from24h: 25,
    semaphore: 'yellow',
    consequences: 'Posibles inundaciones urbanas localizadas y aumento de caudales.',
    actions: 'Intensificar vigilancia de quebradas, ríos y puntos críticos.',
  },
  {
    category: 'intensa',
    label: 'Intensa',
    from3h: 10,
    from6h: 20,
    from12h: 30,
    from24h: 50,
    semaphore: 'orange',
    consequences: 'Inundaciones urbanas, crecidas rápidas y posibles desbordamientos localizados.',
    actions: 'Activar protocolos preventivos y preparar recursos de respuesta.',
  },
  {
    category: 'torrencial',
    label: 'Torrencial',
    from3h: 25,
    from6h: 40,
    from12h: 70,
    from24h: 100,
    semaphore: 'red',
    consequences: 'Inundaciones potencialmente severas, desbordamientos y afectaciones a infraestructura.',
    actions: 'Activar protocolos de respuesta según la amenaza, restringir zonas peligrosas y evaluar evacuaciones.',
  },
  {
    category: 'extrema',
    label: 'Extrema',
    from3h: 50,
    from6h: 80,
    from12h: 140,
    from24h: 250,
    semaphore: 'red',
    consequences: 'Inundaciones potencialmente catastróficas, crecidas repentinas y daños extensos.',
    actions: 'Implementar medidas de emergencia y protección de la población según las condiciones locales.',
  },
];

/** Ventanas del pronóstico, de la más corta a la más larga. */
export const RAIN_WINDOWS = ['3h', '6h', '12h', '24h'] as const;
export type RainWindow = (typeof RAIN_WINDOWS)[number];

/** Categoría de la lluvia de una ventana (mm). */
export function classifyRainWindow(mm: number, window: RainWindow): Band {
  const threshold = `from${window}` as const;
  let band = RAIN_BANDS[0];
  for (const candidate of RAIN_BANDS) if (mm >= candidate[threshold]) band = candidate;
  return band;
}

/**
 * Regla del semáforo del documento, con todas las ventanas: S = máx(S3h, S6h, S12h,
 * S24h). Cada acumulado se clasifica con sus umbrales y se queda la categoría más
 * alta (así no se suma dos veces la misma lluvia y se detectan los aguaceros
 * cortos). Con empate, decide la ventana más corta. Null si no hay ninguna.
 */
export function classifyRain(mm: Partial<Record<RainWindow, number | null>>): { band: Band; decidedBy: RainWindow } | null {
  let result: { band: Band; decidedBy: RainWindow } | null = null;
  for (const window of RAIN_WINDOWS) {
    const value = mm[window];
    if (value === null || value === undefined) continue;
    const band = classifyRainWindow(value, window);
    if (!result || RAIN_BANDS.indexOf(band) > RAIN_BANDS.indexOf(result.band)) result = { band, decidedBy: window };
  }
  return result;
}

export const SEMAPHORE_RANK: Record<Semaphore, number> = { green: 0, yellow: 1, orange: 2, red: 3 };
