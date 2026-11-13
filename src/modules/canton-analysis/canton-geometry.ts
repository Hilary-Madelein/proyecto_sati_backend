import { crossingsAtLatitude, isInsideRings, type Ring } from '../../common/geo/polygon.js';

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

/** Paso de la malla con que se reparte el área de las zonas entre cantones (grados; ~1,1 km). */
const AREA_GRID_STEP = 0.01;

/**
 * Km² de unas zonas (Polygon o MultiPolygon) dentro de cada cantón. Una zona puede
 * cruzar varios cantones, así que no se asigna entera a uno: se recorre una malla
 * de puntos cada ~1,1 km y cada punto que cae dentro de una zona suma su celda al
 * cantón donde está. Es una estimación (las zonas menores que una celda pueden no
 * contarse), suficiente para cifras redondeadas a km². `cells` guarda el cantón de
 * cada punto de la malla entre llamadas.
 */
export function zoneKm2ByCanton(
  zones: readonly ({ type: string; coordinates: unknown } | null)[],
  locator: CantonLocator,
  cells: Map<string, string | null>,
): Map<string, number> {
  const step = AREA_GRID_STEP;
  const result = new Map<string, number>();
  for (const geometry of zones) {
    const polygons = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates as Ring[]] : geometry.type === 'MultiPolygon' ? (geometry.coordinates as Ring[][]) : [];
    for (const rings of polygons) {
      const [west, south, east, north] = bboxOf(rings);
      for (let row = Math.ceil(south / step); row * step <= north; row++) {
        const lat = row * step;
        const crossings = crossingsAtLatitude(rings, lat);
        const cellKm2 = (step * 111.32) ** 2 * Math.cos((lat * Math.PI) / 180);
        // Entre cada par de cruces el punto está dentro (regla par-impar).
        for (let i = 0; i + 1 < crossings.length; i += 2) {
          const from = Math.max(Math.ceil(crossings[i] / step), Math.ceil(west / step));
          const to = Math.min(Math.floor(crossings[i + 1] / step), Math.floor(east / step));
          for (let column = from; column <= to; column++) {
            const key = `${row}|${column}`;
            let code = cells.get(key);
            if (code === undefined) {
              code = locator.locate(column * step, lat)?.code ?? null;
              cells.set(key, code);
            }
            if (code) result.set(code, (result.get(code) ?? 0) + cellKm2);
          }
        }
      }
    }
  }
  return result;
}
