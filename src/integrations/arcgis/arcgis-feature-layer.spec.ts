import { toFeature } from './arcgis-feature-layer.js';

describe('toFeature', () => {
  const geometry = { type: 'Point', coordinates: [-79.2, -3.9] };

  it('deja solo los campos pedidos, aunque el servicio mande más', () => {
    const feature = toFeature(
      { type: 'Feature', geometry, properties: { ESTADO: 'BUENO', chasis: '8LBETF3G7B0075399' } },
      ['ESTADO', 'TIPO'],
      new Set(),
    );
    expect(feature.properties).toEqual({ ESTADO: 'BUENO', TIPO: null });
    expect(feature.geometry).toBe(geometry);
  });

  it('pasa las fechas en milisegundos a ISO 8601 y vacía los textos en blanco', () => {
    const feature = toFeature(
      { type: 'Feature', geometry, properties: { fecha: 1791910800000, obs: '   ', nombre: ' Puente Chanchán ' } },
      ['fecha', 'obs', 'nombre'],
      new Set(['fecha']),
    );
    expect(feature.properties).toEqual({ fecha: '2026-10-13T17:00:00.000Z', obs: null, nombre: 'Puente Chanchán' });
  });

  it('lleva el OBJECTID al id de la entidad y no a sus datos', () => {
    const feature = toFeature(
      { type: 'Feature', geometry, properties: { objectid: 42, estado: 'BAJA' } },
      ['estado'],
      new Set(),
      'objectid',
    );
    expect(feature.id).toBe(42);
    expect(feature.properties).toEqual({ estado: 'BAJA' });
  });
});
