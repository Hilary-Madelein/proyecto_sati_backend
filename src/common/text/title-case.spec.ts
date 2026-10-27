import { toTitleCase } from './title-case.js';

describe('toTitleCase', () => {
  it('pone mayúscula inicial y deja en minúscula los artículos', () => {
    expect(toTitleCase('SANTO DOMINGO DE LOS TSÁCHILAS')).toBe('Santo Domingo de los Tsáchilas');
  });

  it('también después de un paréntesis y con espacios dobles', () => {
    expect(toTitleCase('BOLÍVAR  (SAGRARIO)')).toBe('Bolívar (Sagrario)');
    expect(toTitleCase('CARBO (CONCEPCIÓN)')).toBe('Carbo (Concepción)');
  });
});
