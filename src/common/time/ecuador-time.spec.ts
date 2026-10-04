import { normalizeTime, parseEcuadorDateTime, splitIntoDateRanges, toEcuadorDate } from './ecuador-time.js';

describe('ecuador-time', () => {
  it('convierte a fecha local de Ecuador (UTC-5)', () => {
    // 03:00 UTC del 2 de octubre = 22:00 del 1 de octubre en Ecuador.
    expect(toEcuadorDate(new Date('2026-10-02T03:00:00Z'))).toBe('2026-10-01');
    expect(toEcuadorDate(new Date('2026-10-02T05:00:00Z'))).toBe('2026-10-02');
  });

  it('normaliza horas sin cero inicial o con segundos', () => {
    expect(normalizeTime('9:40')).toBe('09:40');
    expect(normalizeTime('16:05:30')).toBe('16:05');
    expect(normalizeTime('')).toBe('00:00');
    expect(normalizeTime('25:00')).toBe('00:00');
  });

  it('interpreta fecha y hora como hora de Ecuador', () => {
    expect(parseEcuadorDateTime('2026-10-01', '9:40')?.toISOString()).toBe('2026-10-01T14:40:00.000Z');
    expect(parseEcuadorDateTime('01/10/2026', '9:40')).toBeNull();
  });

  it('parte un periodo en rangos de máximo N días, sin huecos ni solapes', () => {
    const ranges = splitIntoDateRanges(new Date('2026-09-01T12:00:00Z'), new Date('2026-09-20T12:00:00Z'), 7);
    expect(ranges).toEqual([
      { from: '2026-09-01', to: '2026-09-07' },
      { from: '2026-09-08', to: '2026-09-14' },
      { from: '2026-09-15', to: '2026-09-20' },
    ]);
  });

  it('devuelve un solo rango si el periodo cabe en uno', () => {
    const day = new Date('2026-10-02T12:00:00Z');
    expect(splitIntoDateRanges(day, day, 7)).toEqual([{ from: '2026-10-02', to: '2026-10-02' }]);
  });
});
