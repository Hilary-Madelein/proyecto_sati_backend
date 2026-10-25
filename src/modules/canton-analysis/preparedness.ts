/**
 * Índice Simplificado de Preparación Provincial frente al Fenómeno de El Niño
 * (ISPP-FEN), del documento "Semaforización para componente Preparación":
 * cuatro conteos por provincia con el mismo peso (25 %), cada uno llevado a 0–100
 * frente a la provincia con más (P = N / N máx × 100), y el índice es su promedio.
 * Mide preparación RELATIVA según los recursos registrados, no suficiencia real.
 */

export type PreparednessIndicator = 'shelters' | 'camps' | 'preventiveActions' | 'roadProjects';

export const PREPAREDNESS_INDICATORS: readonly PreparednessIndicator[] = ['shelters', 'camps', 'preventiveActions', 'roadProjects'];

/** Semáforo del documento (intervalos propuestos, no oficiales), de menor a mayor. */
export type PreparednessLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';

const LEVELS: ReadonlyArray<{ above: number; level: PreparednessLevel }> = [
  { above: 80, level: 'very-high' },
  { above: 60, level: 'high' },
  { above: 40, level: 'medium' },
  { above: 20, level: 'low' },
];

export interface ProvincePreparedness {
  /** Código DPA de 2 dígitos. */
  code: string;
  name: string;
  /** Cantidad registrada de cada indicador (N). */
  counts: Record<PreparednessIndicator, number>;
  /** Puntuación de cada indicador, 0–100 (P). */
  scores: Record<PreparednessIndicator, number>;
  /** ISPP-FEN, 0–100. */
  index: number;
  level: PreparednessLevel;
}

/** Nivel del semáforo: 0–20 muy baja, >20–40 baja, >40–60 media, >60–80 alta, >80–100 muy alta. */
export function preparednessLevel(index: number): PreparednessLevel {
  return LEVELS.find((item) => index > item.above)?.level ?? 'very-low';
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Índice de cada provincia, de la más a la menos preparada. Un indicador sin registros en ninguna provincia vale 0. */
export function preparednessIndex(
  provinces: ReadonlyArray<{ code: string; name: string; counts: Record<PreparednessIndicator, number> }>,
): ProvincePreparedness[] {
  const max = Object.fromEntries(
    PREPAREDNESS_INDICATORS.map((indicator) => [indicator, Math.max(0, ...provinces.map((province) => province.counts[indicator]))]),
  ) as Record<PreparednessIndicator, number>;

  return provinces
    .map((province) => {
      const scores = Object.fromEntries(
        PREPAREDNESS_INDICATORS.map((indicator) => [
          indicator,
          max[indicator] > 0 ? round1((province.counts[indicator] / max[indicator]) * 100) : 0,
        ]),
      ) as Record<PreparednessIndicator, number>;
      const exact = PREPAREDNESS_INDICATORS.reduce(
        (sum, indicator) => sum + (max[indicator] > 0 ? (province.counts[indicator] / max[indicator]) * 100 : 0),
        0,
      );
      const index = round1(exact / PREPAREDNESS_INDICATORS.length);
      return { ...province, scores, index, level: preparednessLevel(index) };
    })
    .sort((a, b) => b.index - a.index || a.name.localeCompare(b.name, 'es'));
}
