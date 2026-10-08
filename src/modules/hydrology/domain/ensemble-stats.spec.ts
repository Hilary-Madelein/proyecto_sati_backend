import { ensembleStats, normalizeRunDate } from './ensemble-stats.js';

describe('ensembleStats', () => {
  // 51 miembros con valores 1…51 en el paso 0 y vacíos en el paso 1; el 52 (alta resolución) con dato en ambos.
  const members = [
    ...Array.from({ length: 51 }, (_, index) => [index + 1, null]),
    [100, 90],
  ];

  it('calcula mín., percentiles, promedio y máx. de los miembros 1–51, como GEOGLOWS', () => {
    const { ensemble, highRes } = ensembleStats(members);
    expect(ensemble.min[0]).toBe(1);
    expect(ensemble.p25[0]).toBe(13.5);
    expect(ensemble.median[0]).toBe(26);
    expect(ensemble.mean[0]).toBe(26);
    expect(ensemble.p75[0]).toBe(38.5);
    expect(ensemble.max[0]).toBe(51);
    // El 52 no entra en las estadísticas: es la alta resolución.
    expect(highRes).toEqual([100, 90]);
  });

  it('un paso sin miembros con dato queda vacío (el ensamble va cada 3 h)', () => {
    const { ensemble } = ensembleStats(members);
    expect(ensemble.median[1]).toBeNull();
    expect(ensemble.max[1]).toBeNull();
  });
});

describe('normalizeRunDate', () => {
  it('acepta AAAA-MM-DD, AAAAMMDD y AAAAMMDDHH', () => {
    expect(normalizeRunDate('2026-10-01')).toBe('20261001');
    expect(normalizeRunDate('20261001')).toBe('20261001');
    expect(normalizeRunDate('2026100100')).toBe('20261001');
  });

  it('rechaza fechas inválidas', () => {
    expect(normalizeRunDate('20261301')).toBeNull();
    expect(normalizeRunDate('2026-02-30')).toBeNull();
    expect(normalizeRunDate('ayer')).toBeNull();
  });
});
