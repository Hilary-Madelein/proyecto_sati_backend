import { monthsBetween, parseArchivedRain } from './inamhi-rain-archive.js';

describe('archivo de lluvia', () => {
  const csv = [
    '﻿codigo,id_estacion,hora_utc,hora_ecuador,lluvia_mm',
    'M1,10,2026-11-02T00:00Z,2026-11-01 19:00,1.5',
    'M1,10,2026-11-02T01:00Z,2026-11-01 20:00,',
    'M1,10,2026-11-02T02:00Z,2026-11-01 21:00,0',
    'M2,20,2026-11-02T01:00Z,2026-11-01 20:00,3',
    'M2,20,2026-11-02T09:00Z,2026-11-02 04:00,9',
    '',
  ].join('\n');

  it('lee la lluvia por estación dentro de la ventana; las horas vacías no cuentan y cero es cero', () => {
    const rain = parseArchivedRain(csv, Date.UTC(2026, 10, 2, 0), Date.UTC(2026, 10, 2, 8));
    expect(rain.get(10)).toEqual([{ time: '2026-11-02T02:00:00.000Z', mm: 0 }]);
    expect(rain.get(20)).toEqual([{ time: '2026-11-02T01:00:00.000Z', mm: 3 }]);
  });

  it('sabe qué meses pedir, también al cruzar de mes o de año', () => {
    expect(monthsBetween(new Date('2026-11-02T01:00Z'), new Date('2026-11-03T01:00Z'))).toEqual(['2026-11']);
    expect(monthsBetween(new Date('2026-12-31T20:00Z'), new Date('2027-01-01T20:00Z'))).toEqual(['2026-12', '2027-01']);
  });
});
