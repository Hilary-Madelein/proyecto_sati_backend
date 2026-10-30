import { nearestRoadFinder, roadCodeOf } from './nearest-road.js';

describe('roadCodeOf', () => {
  it('lee el código de vía que declaran las capas, en sus distintos formatos', () => {
    expect(['E 487', 'E10, 55+000', 'E 493 B', 'E45A, Sector García Moreno', 'e-35'].map(roadCodeOf)).toEqual(['E487', 'E10', 'E493B', 'E45A', 'E35']);
    expect(['ELOY ALFARO', 'Vía a la costa', '', null].map(roadCodeOf)).toEqual([null, null, null, null]);
  });
});

describe('nearestRoadFinder', () => {
  const road = (code: string, coordinates: number[][]) => ({
    type: 'Feature' as const,
    geometry: { type: 'LineString', coordinates },
    properties: { CODIGO_DE_VIA: code },
  });
  // Dos vías paralelas de oeste a este, separadas ~5,5 km (0,05°).
  const nearest = nearestRoadFinder([road('E35', [[-79.2, -2.0], [-79.0, -2.0]]), road('E40', [[-79.2, -2.05], [-79.0, -2.05]])], 'CODIGO_DE_VIA');

  it('da el código de la vía más cercana', () => {
    expect(nearest(-79.1, -2.004)).toBe('E35'); // ~0,4 km de la E35
    expect(nearest(-79.1, -2.046)).toBe('E40');
  });

  it('a más de 1 km de cualquier vía no da código', () => {
    expect(nearest(-79.1, -2.025)).toBeNull(); // a ~2,8 km de las dos
    expect(nearest(-78.5, -2.0)).toBeNull(); // lejos del final de la vía
  });
});
