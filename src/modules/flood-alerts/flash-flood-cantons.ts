import { isInsideRings, type Ring } from '../../common/geo/polygon.js';
import type { ParishPoint } from '../canton-analysis/parishes.js';
import type { FlashFloodArea, FlashFloodLikelihood } from '../flood-hub/flood-hub-source.js';

/** Cantón dentro de una zona de crecidas, con el nivel más alto que le toca. */
export interface CantonForecast {
  /** Código DPA del cantón. */
  code: string;
  canton: string;
  province: string;
  likelihood: FlashFloodLikelihood;
}

export const LIKELIHOOD_RANK: Record<FlashFloodLikelihood, number> = { likely: 1, highly_likely: 2 };

/**
 * Cantones afectados por las zonas de Google, que no traen nombres de lugares:
 * un cantón cuenta si el punto de alguna de sus parroquias cae dentro de una zona.
 */
export function cantonsInZones(areas: readonly FlashFloodArea[], parishes: readonly ParishPoint[]): CantonForecast[] {
  const cantons = new Map<string, CantonForecast>();
  for (const area of areas) {
    const polygons = area.geometry.coordinates as unknown as Ring[][];
    for (const parish of parishes) {
      if (!polygons.some((rings) => isInsideRings(rings, parish.lng, parish.lat))) continue;
      const known = cantons.get(parish.cantonCode);
      if (known && LIKELIHOOD_RANK[known.likelihood] >= LIKELIHOOD_RANK[area.likelihood]) continue;
      cantons.set(parish.cantonCode, {
        code: parish.cantonCode,
        canton: parish.canton,
        province: parish.province,
        likelihood: area.likelihood,
      });
    }
  }
  return [...cantons.values()];
}
