import { loadParishes } from '../../modules/canton-analysis/parishes.js';
import { ECUADOR_RINGS } from './ecuador-boundary.js';
import { isInsideRings, type Ring } from './polygon.js';

describe('isInsideRings', () => {
  // Dos anillos separados: con la regla par-impar se reconocen ambos.
  const square: Ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const island: Ring = [
    [20, 0],
    [22, 0],
    [22, 2],
    [20, 2],
  ];

  it.each([
    [5, 5, true],
    [21, 1, true],
    [15, 5, false],
    [-1, 5, false],
    [5, 11, false],
  ])('(%s, %s) dentro: %s', (lng, lat, inside) => {
    expect(isInsideRings([square, island], lng, lat)).toBe(inside);
  });
});

describe('ECUADOR_RINGS', () => {
  it.each([
    ['Quito', -78.4678, -0.1807, true],
    // Puntos en tierra: el contorno trata como agua el estuario del Guayas y la orilla del mar.
    ['Guayaquil (Urdesa)', -79.91, -2.17, true],
    ['Guayaquil (centro)', -79.88667, -2.19872, true],
    ['Esmeraldas (centro)', -79.655, 0.97, true],
    ['Isla Puná', -80.13, -2.84, true],
    ['Lima (Perú)', -77.0428, -12.0464, false],
    ['Tumbes (Perú)', -80.4528, -3.5669, false],
    ['Ipiales (Colombia)', -77.6406, 0.8303, false],
    ['Océano Pacífico', -81.5, -1, false],
    ['Golfo de Guayaquil', -80.45, -3.05, false],
  ])('%s', (_name, lng, lat, inside) => {
    expect(isInsideRings(ECUADOR_RINGS, lng, lat)).toBe(inside);
  });

  it('incluye todas las parroquias continentales: donde hay alerta, también se ve su lluvia', async () => {
    const parishes = await loadParishes();
    // Galápagos (código 20) queda fuera a propósito: las grillas de lluvia no llegan allá.
    const missing = parishes.filter(({ code, lat, lng }) => !code.startsWith('20') && !isInsideRings(ECUADOR_RINGS, lng, lat));
    expect(missing.map(({ name }) => name)).toEqual([]);
  });
});
