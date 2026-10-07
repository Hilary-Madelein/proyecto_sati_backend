import { annualMaxima, antecedentConditions, gumbelReturnPeriods } from './return-periods.js';

describe('annualMaxima', () => {
  it('toma el máximo de cada año desde el año pedido e ignora los vacíos', () => {
    const times = ['1979-05-01', '1980-01-01', '1980-06-01', '1981-03-01', '1981-04-01'];
    expect(annualMaxima(times, [99, 3, 7, null, 4], 1980)).toEqual([7, 4]);
  });
});

describe('gumbelReturnPeriods', () => {
  it('ajusta Gumbel por momentos y redondea a un decimal', () => {
    // Media 10, desviación ≈ 3,16: Q(2) = 10 − 0,164·3,16 ≈ 9,5; Q(100) = 10 + 3,137·3,16 ≈ 19,9.
    const result = gumbelReturnPeriods([6, 8, 10, 12, 14]);
    expect(result.map((item) => item.years)).toEqual([2, 5, 10, 25, 50, 100]);
    expect(result[0].flow).toBeCloseTo(9.5, 1);
    expect(result.at(-1)!.flow).toBeCloseTo(19.9, 1);
    // Periodos más largos = caudales mayores.
    const flows = result.map((item) => item.flow);
    expect(flows).toEqual(flows.toSorted((a, b) => a - b));
  });

  it('sin al menos dos años no hay estadística', () => {
    expect(gumbelReturnPeriods([5])).toEqual([]);
  });
});

describe('antecedentConditions', () => {
  const times = [
    '2026-09-28T00:00:00+00:00',
    '2026-09-29T00:00:00+00:00',
    '2026-09-29T03:00:00+00:00',
    '2026-09-30T00:00:00+00:00',
    '2026-10-01T00:00:00+00:00',
  ];

  it('toma el valor de las 00:00 de cada día dentro de la ventana, hasta el inicio del pronóstico', () => {
    const result = antecedentConditions(times, [1, 6.1, 0.7, 5.6, 7], '2026-09-30T00:00:00Z', 1);
    expect(result).toEqual({ times: ['2026-09-29T00:00:00.000Z', '2026-09-30T00:00:00.000Z'], flow: [6.1, 5.6] });
  });
});
