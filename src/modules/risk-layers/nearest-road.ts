import type { GeoJsonFeature } from '../../integrations/arcgis/arcgis-feature-layer.js';

/** "E 487" → "E487", "E10, 55+000" → "E10", "E 493 B" → "E493B"; null si el texto no empieza con un código de vía. */
export function roadCodeOf(text: unknown): string | null {
  const match = /^\s*E\s*-?\s*(\d+)\s*([A-Z])?(?![A-Z0-9])/i.exec(String(text ?? ''));
  return match ? `E${match[1]}${(match[2] ?? '').toUpperCase()}` : null;
}

/** Más lejos que esto (km) un punto no se considera sobre una vía de la RVE. */
export const NEAREST_ROAD_MAX_KM = 1;
/** Celdas del índice de tramos, en grados (~5,5 km). */
const CELL_DEGREES = 0.05;
const KM_PER_DEGREE = 111.32;

interface Segment {
  code: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Tramos [inicio, fin] de un LineString o MultiLineString. */
function linesOf(geometry: GeoJsonFeature['geometry']): number[][][] {
  if (geometry?.type === 'LineString') return [geometry.coordinates as number[][]];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates as number[][][];
  return [];
}

/** Distancia (km) de un punto a un segmento, en un plano local (precisa a estas distancias). */
function distanceKm(x: number, y: number, s: Segment): number {
  const k = Math.cos((y * Math.PI) / 180);
  const [px, py, ax, ay, bx, by] = [x * k, y, s.ax * k, s.ay, s.bx * k, s.by];
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * KM_PER_DEGREE;
}

/**
 * Código de la vía de la RVE más cercana a un punto (p. ej. "E35"), o null si
 * no hay ninguna a menos de NEAREST_ROAD_MAX_KM. Los tramos se indexan en celdas
 * para no recorrer toda la red con cada punto.
 */
export function nearestRoadFinder(roads: readonly GeoJsonFeature[], codeField: string): (lng: number, lat: number) => string | null {
  const cells = new Map<string, Segment[]>();
  const key = (cx: number, cy: number) => `${cx}:${cy}`;
  for (const road of roads) {
    const code = String(road.properties[codeField] ?? '').trim();
    if (!code) continue;
    for (const line of linesOf(road.geometry)) {
      for (let i = 1; i < line.length; i++) {
        const segment = { code, ax: line[i - 1][0], ay: line[i - 1][1], bx: line[i][0], by: line[i][1] };
        const x0 = Math.floor(Math.min(segment.ax, segment.bx) / CELL_DEGREES);
        const x1 = Math.floor(Math.max(segment.ax, segment.bx) / CELL_DEGREES);
        const y0 = Math.floor(Math.min(segment.ay, segment.by) / CELL_DEGREES);
        const y1 = Math.floor(Math.max(segment.ay, segment.by) / CELL_DEGREES);
        for (let cx = x0; cx <= x1; cx++) {
          for (let cy = y0; cy <= y1; cy++) {
            const list = cells.get(key(cx, cy));
            if (list) list.push(segment);
            else cells.set(key(cx, cy), [segment]);
          }
        }
      }
    }
  }

  return (lng, lat) => {
    const cx = Math.floor(lng / CELL_DEGREES);
    const cy = Math.floor(lat / CELL_DEGREES);
    let best: { code: string; km: number } | null = null;
    // La celda del punto y sus vecinas: más de 1 km de alcance en cualquier dirección.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const segment of cells.get(key(cx + dx, cy + dy)) ?? []) {
          const km = distanceKm(lng, lat, segment);
          if (km <= NEAREST_ROAD_MAX_KM && (!best || km < best.km)) best = { code: segment.code, km };
        }
      }
    }
    return best?.code ?? null;
  };
}
