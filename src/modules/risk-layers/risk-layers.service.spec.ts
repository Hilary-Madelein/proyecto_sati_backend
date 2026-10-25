import { located } from './risk-layers.service.js';

describe('located', () => {
  const point = (coordinates: unknown) => ({ type: 'Feature' as const, geometry: { type: 'Point', coordinates }, properties: {} });

  it('descarta las entidades sin geometría o fuera del Ecuador', () => {
    const result = located([
      point([-79.2, -3.9]),
      point([-90.3, -0.7]), // Galápagos
      point([-78.74668, -89.99998]), // latitud de -90: coordenada mal cargada
      point([9682345, 748036]), // UTM tomada como grados
      { type: 'Feature', geometry: null, properties: {} },
    ]);
    expect(result.features.map((feature) => feature.geometry?.coordinates)).toEqual([[-79.2, -3.9], [-90.3, -0.7]]);
    expect(result.omitted).toBe(3);
  });

  it('mira el primer vértice de líneas y polígonos', () => {
    const line = { type: 'Feature' as const, geometry: { type: 'MultiLineString', coordinates: [[[-80, -2], [-79.9, -2.1]]] }, properties: {} };
    expect(located([line]).omitted).toBe(0);
  });
});
