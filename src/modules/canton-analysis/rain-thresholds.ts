/** Color del semáforo por lluvia de 12 h: solo tres (el naranja del documento pasa a rojo). */
export type Semaphore = 'green' | 'yellow' | 'red';

export type RainCategory = 'minima' | 'ligera' | 'moderada' | 'fuerte' | 'intensa' | 'torrencial' | 'extrema';

interface Band {
  category: RainCategory;
  label: string;
  /** Lluvia de 12 h desde la que empieza la categoría (mm). */
  from12h: number;
  semaphore: Semaphore;
  consequences: string;
  actions: string;
}

/**
 * Umbrales de lluvia de 12 h, consecuencias y acciones del documento "Lluvia de
 * 12 horas" (25/10/2026). Con tres colores: verde hasta ligera, amarillo
 * moderada y fuerte, rojo desde intensa.
 */
export const RAIN_12H_BANDS: readonly Band[] = [
  { category: 'minima', label: 'Mínima', from12h: 0, semaphore: 'green', consequences: 'Sin impactos significativos por lluvia nueva.', actions: 'Monitoreo rutinario.' },
  { category: 'ligera', label: 'Ligera', from12h: 0.1, semaphore: 'green', consequences: 'Escorrentía superficial limitada.', actions: 'Seguimiento meteorológico habitual.' },
  {
    category: 'moderada',
    label: 'Moderada',
    from12h: 5,
    semaphore: 'yellow',
    consequences: 'Encharcamientos localizados y posibles problemas de drenaje.',
    actions: 'Vigilar zonas bajas y sistemas de drenaje.',
  },
  {
    category: 'fuerte',
    label: 'Fuerte',
    from12h: 15,
    semaphore: 'yellow',
    consequences: 'Posibles inundaciones urbanas localizadas y aumento de caudales.',
    actions: 'Intensificar vigilancia de quebradas, ríos y puntos críticos.',
  },
  {
    category: 'intensa',
    label: 'Intensa',
    from12h: 30,
    semaphore: 'red',
    consequences: 'Inundaciones urbanas, crecidas rápidas y posibles desbordamientos localizados.',
    actions: 'Activar protocolos preventivos y preparar recursos de respuesta.',
  },
  {
    category: 'torrencial',
    label: 'Torrencial',
    from12h: 70,
    semaphore: 'red',
    consequences: 'Inundaciones potencialmente severas, desbordamientos y afectaciones a infraestructura.',
    actions: 'Activar protocolos de respuesta según la amenaza, restringir zonas peligrosas y evaluar evacuaciones.',
  },
  {
    category: 'extrema',
    label: 'Extrema',
    from12h: 140,
    semaphore: 'red',
    consequences: 'Inundaciones potencialmente catastróficas, crecidas repentinas y daños extensos.',
    actions: 'Implementar medidas de emergencia y protección de la población según las condiciones locales.',
  },
];

/** Categoría de una lluvia de 12 h (mm). */
export function classifyRain12h(mm: number): Band {
  let band = RAIN_12H_BANDS[0];
  for (const candidate of RAIN_12H_BANDS) if (mm >= candidate.from12h) band = candidate;
  return band;
}

export const SEMAPHORE_RANK: Record<Semaphore, number> = { green: 0, yellow: 1, red: 2 };
