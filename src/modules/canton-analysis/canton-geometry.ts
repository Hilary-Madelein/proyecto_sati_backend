import { isInsideRings, type Ring } from '../../common/geo/polygon.js';

/** Cantón con su contorno listo para ubicar puntos (anillos [lng, lat] y recuadro). */
export interface CantonShape {
  /** Código DPA de 4 dígitos, p. ej. "0101". */
  code: string;
  name: string;
  /** Código DPA de 2 dígitos de la provincia a la que pertenece hoy (ver PROVINCE_UPDATES). */
  provinceCode: string;
  province: string;
  /** Región del INEC (Costa, Sierra, Amazonía, Región Insular); null si no viene. */
  region: string | null;
  population: number | null;
  /** Área oficial del cantón (km²); null si no viene. */
  areaKm2: number | null;
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

/** Recuadro [oeste, sur, este, norte] de un LineString o MultiLineString; null si no es una línea. */
export function lineBox(geometry: { type: string; coordinates: unknown } | null): [number, number, number, number] | null {
  const points = segmentsOf(geometry).flat();
  if (points.length === 0) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/** Un punto que represente a la entidad: el punto, o el primer vértice de una línea o zona. */
export function anchorOf(geometry: { type: string; coordinates: unknown } | null): [number, number] | null {
  let current: unknown = geometry?.coordinates;
  while (Array.isArray(current) && Array.isArray(current[0])) current = current[0];
  return Array.isArray(current) && typeof current[0] === 'number' && typeof current[1] === 'number'
    ? [current[0], current[1]]
    : null;
}
