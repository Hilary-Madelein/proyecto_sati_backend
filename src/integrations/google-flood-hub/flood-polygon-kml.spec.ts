import { kmlToMultiPolygon } from './flood-polygon-kml.js';

const ring = '-79.7,-3.8 -79.6,-3.8 -79.6,-3.6 -79.7,-3.8';
const polygon = (inner = '') =>
  `<Polygon><altitudeMode>clampToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon>`;
const kml = (body: string) =>
  `<?xml version='1.0' encoding='UTF-8'?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>InundationPolygon</name><Style/>${body}</Placemark></Document></kml>`;
const coordinates = [
  [-79.7, -3.8],
  [-79.6, -3.8],
  [-79.6, -3.6],
  [-79.7, -3.8],
];

describe('kmlToMultiPolygon', () => {
  it('convierte un polígono simple', () => {
    expect(kmlToMultiPolygon(kml(polygon()))).toEqual({ type: 'MultiPolygon', coordinates: [[coordinates]] });
  });

  it('convierte MultiGeometry en varios polígonos', () => {
    const geometry = kmlToMultiPolygon(kml(`<MultiGeometry>${polygon()}${polygon()}</MultiGeometry>`));
    expect(geometry?.coordinates).toHaveLength(2);
  });

  it('conserva los huecos', () => {
    const hole = `<innerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></innerBoundaryIs>`;
    expect(kmlToMultiPolygon(kml(polygon(hole)))?.coordinates[0]).toHaveLength(2);
  });

  it('devuelve null si no hay polígonos', () => {
    expect(kmlToMultiPolygon(kml(''))).toBeNull();
  });
});
