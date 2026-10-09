import { runFromSteps, stepsOfDay } from './inamhi-catalog-rain-forecast.source.js';

/** Pasos de 3 h desde `from` hasta `to` (inclusive), como los publica el catálogo del INAMHI. */
function steps(from: string, to: string): string[] {
  const result: string[] = [];
  for (let time = Date.parse(from); time <= Date.parse(to); time += 3 * 3_600_000) result.push(new Date(time).toISOString());
  return result;
}

describe('stepsOfDay', () => {
  it('son los 8 pasos de 3 h que terminan dentro de esas 24 h', () => {
    const day = stepsOfDay('2026-10-10T01:00:00.000Z');
    expect(day).toHaveLength(8);
    expect(day[0]).toBe('2026-10-09T04:00:00.000Z');
    expect(day.at(-1)).toBe('2026-10-10T01:00:00.000Z');
  });
});

describe('runFromSteps', () => {
  it('deduce el inicio de la corrida (último paso − 72 h) y ofrece los 3 días completos', () => {
    // Ventana del catálogo: ~7 días atrás y la corrida del 9 de octubre (01:00 UTC) hasta +72 h.
    const run = runFromSteps(steps('2026-10-02T10:00:00.000Z', '2026-10-12T01:00:00.000Z'));
    expect(run).toEqual({
      run: '2026-10-09T01:00:00.000Z',
      dailyTimes: ['2026-10-10T01:00:00.000Z', '2026-10-11T01:00:00.000Z', '2026-10-12T01:00:00.000Z'],
    });
  });

  it('un día al que le falta algún paso no se ofrece', () => {
    const published = steps('2026-10-08T01:00:00.000Z', '2026-10-12T01:00:00.000Z').filter(
      (time) => time !== '2026-10-11T13:00:00.000Z',
    );
    expect(runFromSteps(published)?.dailyTimes).toEqual(['2026-10-10T01:00:00.000Z', '2026-10-11T01:00:00.000Z']);
  });

  it('sin pasos no hay corrida', () => {
    expect(runFromSteps([])).toBeNull();
  });
});
