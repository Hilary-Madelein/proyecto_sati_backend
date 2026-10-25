import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { CantonLocator, bboxOf, distanceKm, ringsOf, segmentsOf, zonalP90, type CantonShape } from './canton-geometry.js';
import { classifyRain12h } from './rain-thresholds.js';

describe('classifyRain12h', () => {
  it('usa los umbrales de 12 h del documento con tres colores (el naranja pasa a rojo)', () => {
    expect([0, 0.05, 4.9].map((mm) => classifyRain12h(mm).semaphore)).toEqual(['green', 'green', 'green']);
    expect([5, 14.9, 15, 29.9].map((mm) => classifyRain12h(mm).semaphore)).toEqual(['yellow', 'yellow', 'yellow', 'yellow']);
    expect([30, 69.9, 70, 140].map((mm) => classifyRain12h(mm).semaphore)).toEqual(['red', 'red', 'red', 'red']);
    expect([0.05, 3, 10, 20, 50, 100, 200].map((mm) => classifyRain12h(mm).label)).toEqual([
      'Mínima',
      'Ligera',
      'Moderada',
      'Fuerte',
      'Intensa',
      'Torrencial',
      'Extrema',
    ]);
  });
});

/** Cuadrado de 1° x 1° con esquina en (lng, lat). */
const square = (code: string, lng: number, lat: number): CantonShape => {
  const rings = ringsOf({
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + 1, lat],
        [lng + 1, lat + 1],
        [lng, lat + 1],
        [lng, lat],
      ],
    ],
  });
  return { code, name: code, province: 'P', population: null, rings, bbox: bboxOf(rings) };
};

describe('CantonLocator', () => {
  it('ubica cada punto en el cantón que lo contiene', () => {
    const locator = new CantonLocator([square('A', -80, -2), square('B', -79, -2)]);
    expect(locator.locate(-79.5, -1.5)?.code).toBe('A');
    expect(locator.locate(-78.5, -1.5)?.code).toBe('B');
    expect(locator.locate(-70, -1.5)).toBeNull();
  });
});

describe('zonalP90', () => {
  // Grilla de 10 x 10 celdas de 0,1° sobre el cantón A; la lluvia crece de oeste a este (0 a 9 mm).
  const grid: RasterGrid = {
    width: 10,
    height: 10,
    bbox: [-80, -2, -79, -1],
    values: Float64Array.from({ length: 100 }, (_, i) => i % 10),
    noData: null,
  };

  it('toma el percentil 90 de las celdas dentro del cantón', () => {
    expect(zonalP90(grid, square('A', -80, -2))).toBe(9);
  });

  it('con un cantón más chico que una celda usa la del centro', () => {
    const tiny = square('T', -79.55, -1.55);
    const small: CantonShape = { ...tiny, rings: ringsOf({ type: 'Polygon', coordinates: [[[-79.55, -1.55], [-79.54, -1.55], [-79.54, -1.54], [-79.55, -1.54], [-79.55, -1.55]]] }) };
    small.bbox = bboxOf(small.rings);
    expect(zonalP90(grid, small)).toBe(4);
  });
});

describe('líneas', () => {
  it('parte las líneas en tramos y mide su largo en km', () => {
    const segments = segmentsOf({ type: 'MultiLineString', coordinates: [[[-79, -2], [-79, -1], [-78, -1]]] });
    expect(segments).toHaveLength(2);
    expect(distanceKm(...segments[0])).toBeCloseTo(111.2, 0);
  });
});
