import { crossingsAtLatitude, isInsideCrossings, isInsideRings, type Ring } from '../../common/geo/polygon.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';

/** Cantón con su contorno listo para ubicar puntos (anillos [lng, lat] y recuadro). */
export interface CantonShape {
  /** Código DPA de 4 dígitos, p. ej. "0101". */
  code: string;
  name: string;
  province: string;
  /** Región del INEC (Costa, Sierra, Amazonía, Región Insular); null si no viene. */
  region: string | null;
  population: number | null;
  rings: Ring[];
  /** [oeste, sur, este, norte]. */
  bbox: [number, number, number, number];
}

/** Anillos de un Polygon o MultiPolygon GeoJSON (los huecos van como un anillo más: regla par-impar). */
export function ringsOf(geometry: { type: string; coordinates: unknown } | null): Ring[] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as Ring[][]).flat();
  return [];
}

export function bboxOf(rings: readonly Ring[]): [number, number, number, number] {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return [west, south, east, north];
}

/** Ubica puntos en cantones; primero descarta por recuadro y luego prueba el contorno. */
export class CantonLocator {
  constructor(readonly cantons: readonly CantonShape[]) {}

  locate(lng: number, lat: number): CantonShape | null {
    for (const canton of this.cantons) {
      const [west, south, east, north] = canton.bbox;
      if (lng < west || lng > east || lat < south || lat > north) continue;
      if (isInsideRings(canton.rings, lng, lat)) return canton;
    }
    return null;
  }
}

/**
 * Valor que representa la lluvia de la grilla en el cantón: el percentil 90 de
 * las celdas cuyo centro cae dentro. Con el promedio, un aguacero fuerte en una
 * parte de un cantón grande se diluye; con el máximo, una sola celda lo decide.
 * Si ninguna celda cae dentro (cantón más chico que una celda), la del centro.
 */
export function zonalP90(grid: RasterGrid, canton: CantonShape): number | null {
  const [gWest, gSouth, gEast, gNorth] = grid.bbox;
  const cellW = (gEast - gWest) / grid.width;
  const cellH = (gNorth - gSouth) / grid.height;
  const [west, south, east, north] = canton.bbox;
  const firstRow = Math.max(0, Math.floor((gNorth - north) / cellH));
  const lastRow = Math.min(grid.height - 1, Math.ceil((gNorth - south) / cellH));
  const firstCol = Math.max(0, Math.floor((west - gWest) / cellW));
  const lastCol = Math.min(grid.width - 1, Math.ceil((east - gWest) / cellW));

  const values: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const lat = gNorth - (row + 0.5) * cellH;
    const crossings = crossingsAtLatitude(canton.rings, lat);
    if (crossings.length === 0) continue;
    for (let col = firstCol; col <= lastCol; col++) {
      if (!isInsideCrossings(crossings, gWest + (col + 0.5) * cellW)) continue;
      const value = grid.values[row * grid.width + col];
      if (Number.isFinite(value) && value !== grid.noData && value >= 0) values.push(value);
    }
  }

  if (values.length === 0) {
    const lng = (west + east) / 2;
    const lat = (south + north) / 2;
    if (lng < gWest || lng >= gEast || lat <= gSouth || lat > gNorth) return null;
    const value = grid.values[Math.floor((gNorth - lat) / cellH) * grid.width + Math.floor((lng - gWest) / cellW)];
    return Number.isFinite(value) && value !== grid.noData && value >= 0 ? value : null;
  }
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.9))];
}

/** Distancia en km entre dos puntos [lng, lat] (fórmula del haversine). */
export function distanceKm([lng1, lat1]: readonly number[], [lng2, lat2]: readonly number[]): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Tramos [inicio, fin] de un LineString o MultiLineString. */
export function segmentsOf(geometry: { type: string; coordinates: unknown } | null): [number[], number[]][] {
  if (!geometry) return [];
  const lines =
    geometry.type === 'LineString'
      ? [geometry.coordinates as number[][]]
      : geometry.type === 'MultiLineString'
        ? (geometry.coordinates as number[][][])
        : [];
  return lines.flatMap((line) => line.slice(1).map((point, i) => [line[i], point] as [number[], number[]]));
}

/** Un punto que represente a la entidad: el punto, o el primer vértice de una línea o zona. */
export function anchorOf(geometry: { type: string; coordinates: unknown } | null): [number, number] | null {
  let current: unknown = geometry?.coordinates;
  while (Array.isArray(current) && Array.isArray(current[0])) current = current[0];
  return Array.isArray(current) && typeof current[0] === 'number' && typeof current[1] === 'number'
    ? [current[0], current[1]]
    : null;
}
