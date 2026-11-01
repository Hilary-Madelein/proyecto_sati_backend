import { XMLParser } from 'fast-xml-parser';
import type { FlashFloodGeometry } from '../../modules/flood-hub/flood-hub-source.js';

interface KmlBoundary {
  LinearRing?: { coordinates?: string };
}

interface KmlPolygon {
  outerBoundaryIs?: KmlBoundary;
  innerBoundaryIs?: KmlBoundary[];
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  // Pueden repetirse: siempre como lista para tratarlas igual.
  isArray: (name) => name === 'Polygon' || name === 'innerBoundaryIs',
});

/** Polígonos de cualquier nivel del KML (un Placemark trae Polygon o MultiGeometry). */
function findPolygons(node: unknown): KmlPolygon[] {
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([name, value]) =>
    name === 'Polygon' ? (value as KmlPolygon[]) : findPolygons(value),
  );
}

/** "lng,lat lng,lat ..." a pares de números. */
function toRing(boundary: KmlBoundary | undefined): number[][] {
  const text = boundary?.LinearRing?.coordinates?.trim();
  if (!text) return [];
  return text.split(/\s+/).map((point) => point.split(',').slice(0, 2).map(Number));
}

/** Convierte el KML de `serializedPolygons` en un MultiPolygon de GeoJSON; null si no trae ninguna zona. */
export function kmlToMultiPolygon(kml: string): FlashFloodGeometry | null {
  const coordinates = findPolygons(parser.parse(kml)).flatMap((polygon) => {
    const outer = toRing(polygon.outerBoundaryIs);
    if (outer.length < 4) return [];
    return [[outer, ...(polygon.innerBoundaryIs ?? []).map(toRing)]];
  });
  return coordinates.length > 0 ? { type: 'MultiPolygon', coordinates } : null;
}
