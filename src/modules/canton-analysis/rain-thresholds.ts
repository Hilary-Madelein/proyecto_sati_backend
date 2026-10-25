/** Color del semáforo por lluvia de 12 y 24 h: solo tres (el naranja del documento pasa a rojo). */
export type Semaphore = 'green' | 'yellow' | 'red';

export type RainCategory = 'minima' | 'ligera' | 'moderada' | 'fuerte' | 'intensa' | 'torrencial' | 'extrema';

interface Band {
  category: RainCategory;
  label: string;
  /** Lluvia de 12 h desde la que empieza la categoría (mm). */
  from12h: number;
  /** Lluvia de 24 h desde la que empieza la categoría (mm). */
  from24h: number;
  semaphore: Semaphore;
  consequences: string;
  actions: string;
}

/**
 * Umbrales de lluvia de 12 y 24 h, consecuencias y acciones del documento
 * "Lluvia de 12 horas" (25/10/2026), de menor a mayor. Con tres colores: verde
 * hasta ligera, amarillo moderada y fuerte, rojo desde intensa.
 */
export const RAIN_BANDS: readonly Band[] = [
  {
    category: 'minima',
    label: 'Mínima',
    from12h: 0,
    from24h: 0,
    semaphore: 'green',
    consequences: 'Sin impactos significativos por lluvia nueva.',
    actions: 'Monitoreo rutinario.',
  },
  {
    category: 'ligera',
    label: 'Ligera',
    from12h: 0.1,
    from24h: 0.1,
    semaphore: 'green',
    consequences: 'Escorrentía superficial limitada.',
    actions: 'Seguimiento meteorológico habitual.',
  },
  {
    category: 'moderada',
    label: 'Moderada',
    from12h: 5,
    from24h: 10,
    semaphore: 'yellow',
    consequences: 'Encharcamientos localizados y posibles problemas de drenaje.',
    actions: 'Vigilar zonas bajas y sistemas de drenaje.',
  },
  {
    category: 'fuerte',
    label: 'Fuerte',
    from12h: 15,
    from24h: 25,
    semaphore: 'yellow',
    consequences: 'Posibles inundaciones urbanas localizadas y aumento de caudales.',
    actions: 'Intensificar vigilancia de quebradas, ríos y puntos críticos.',
  },
  {
    category: 'intensa',
    label: 'Intensa',
    from12h: 30,
    from24h: 50,
    semaphore: 'red',
    consequences: 'Inundaciones urbanas, crecidas rápidas y posibles desbordamientos localizados.',
    actions: 'Activar protocolos preventivos y preparar recursos de respuesta.',
  },
  {
    category: 'torrencial',
    label: 'Torrencial',
    from12h: 70,
    from24h: 100,
    semaphore: 'red',
    consequences: 'Inundaciones potencialmente severas, desbordamientos y afectaciones a infraestructura.',
    actions: 'Activar protocolos de respuesta según la amenaza, restringir zonas peligrosas y evaluar evacuaciones.',
  },
  {
    category: 'extrema',
    label: 'Extrema',
    from12h: 140,
    from24h: 250,
    semaphore: 'red',
    consequences: 'Inundaciones potencialmente catastróficas, crecidas repentinas y daños extensos.',
    actions: 'Implementar medidas de emergencia y protección de la población según las condiciones locales.',
  },
];

/** Categoría de una lluvia de 12 h (mm). */
export function classifyRain12h(mm: number): Band {
  return classify(mm, 'from12h');
}

/** Categoría de una lluvia de 24 h (mm). */
export function classifyRain24h(mm: number): Band {
  return classify(mm, 'from24h');
}

function classify(mm: number, threshold: 'from12h' | 'from24h'): Band {
  let band = RAIN_BANDS[0];
  for (const candidate of RAIN_BANDS) if (mm >= candidate[threshold]) band = candidate;
  return band;
}

export type RainWindow = '12h' | '24h';

/**
 * Regla del semáforo del documento: S = máx(S12h, S24h). Cada acumulado se
 * clasifica con sus umbrales y se queda la categoría más alta (así no se suma
 * dos veces la misma lluvia y se detectan los aguaceros cortos). Con empate,
 * decide la de 12 h. Null si no hay ninguno de los dos.
 */
export function classifyRain(mm12h: number | null, mm24h: number | null): { band: Band; decidedBy: RainWindow } | null {
  if (mm12h === null && mm24h === null) return null;
  const by12h = classifyRain12h(mm12h ?? 0);
  const by24h = classifyRain24h(mm24h ?? 0);
  return RAIN_BANDS.indexOf(by24h) > RAIN_BANDS.indexOf(by12h) ? { band: by24h, decidedBy: '24h' } : { band: by12h, decidedBy: '12h' };
}

export const SEMAPHORE_RANK: Record<Semaphore, number> = { green: 0, yellow: 1, red: 2 };
