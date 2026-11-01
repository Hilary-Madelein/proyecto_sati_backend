import { describe, expect, it } from 'vitest';
import type { FlashFloodArea, FlashFloodLikelihood } from '../flood-hub/flood-hub-source.js';
import type { ParishPoint } from '../canton-analysis/parishes.js';
import { cantonsInZones, type CantonForecast } from './flash-flood-cantons.js';
import { applyExpiry, applyIssue, type WatchedCanton } from './flash-flood-transitions.js';

const canton = (code: string, likelihood: FlashFloodLikelihood): CantonForecast => ({
  code,
  canton: `Cantón ${code}`,
  province: 'Guayas',
  likelihood,
});
const watched = (code: string, likelihood: FlashFloodLikelihood, lowerRuns = 0): WatchedCanton => ({ ...canton(code, likelihood), lowerRuns });
const codes = (list: readonly { code: string }[]) => list.map((item) => item.code);

describe('applyIssue', () => {
  it('avisa de inmediato lo que entra y lo que sube a Muy probable', () => {
    const changes = applyIssue([watched('a', 'likely')], [canton('a', 'highly_likely'), canton('b', 'likely')]);
    expect(codes(changes.worsened).sort()).toEqual(['a', 'b']);
    expect(changes.watched.find((item) => item.code === 'a')?.likelihood).toBe('highly_likely');
  });

  it('no avisa si nada cambia, aunque Google haya reemitido', () => {
    const changes = applyIssue([watched('a', 'likely'), watched('b', 'highly_likely')], [canton('a', 'likely'), canton('b', 'highly_likely')]);
    expect(changes).toMatchObject({ worsened: [], lowered: [], left: [] });
  });

  it('una bajada se avisa solo si la emisión siguiente la confirma', () => {
    const first = applyIssue([watched('a', 'highly_likely')], [canton('a', 'likely')]);
    expect(first.lowered).toEqual([]);
    expect(first.watched[0]).toMatchObject({ likelihood: 'highly_likely', lowerRuns: 1 });

    const second = applyIssue(first.watched, [canton('a', 'likely')]);
    expect(codes(second.lowered)).toEqual(['a']);
    expect(second.watched[0]).toMatchObject({ likelihood: 'likely', lowerRuns: 0 });
  });

  it('una salida pasajera no se avisa ni se vuelve a alertar', () => {
    const gone = applyIssue([watched('a', 'likely')], []);
    expect(gone.left).toEqual([]);
    const back = applyIssue(gone.watched, [canton('a', 'likely')]);
    expect(back).toMatchObject({ worsened: [], left: [] });
    expect(back.watched[0].lowerRuns).toBe(0);
  });

  it('si reaparece después de avisar su salida, se alerta otra vez', () => {
    const first = applyIssue([watched('a', 'likely')], []);
    const second = applyIssue(first.watched, []);
    expect(codes(second.left)).toEqual(['a']);
    expect(second.watched).toEqual([]);
    expect(codes(applyIssue(second.watched, [canton('a', 'likely')]).worsened)).toEqual(['a']);
  });

  it('subir mientras una bajada espera confirmación la anula', () => {
    const first = applyIssue([watched('a', 'highly_likely')], [canton('a', 'likely')]);
    const second = applyIssue(first.watched, [canton('a', 'highly_likely')]);
    expect(second).toMatchObject({ worsened: [], lowered: [] });
    expect(second.watched[0].lowerRuns).toBe(0);
  });
});

describe('applyExpiry', () => {
  it('cierra todos los avisos sin esperar otra emisión', () => {
    const changes = applyExpiry([watched('a', 'likely', 1), watched('b', 'highly_likely')]);
    expect(codes(changes.left)).toEqual(['a', 'b']);
    expect(changes.watched).toEqual([]);
  });
});

describe('cantonsInZones', () => {
  const square = (likelihood: FlashFloodLikelihood, west: number, east: number): FlashFloodArea => ({
    id: `${likelihood}-${west}`,
    likelihood,
    issuedAt: '2026-11-01T19:33:35Z',
    validUntil: '2026-11-02T19:33:35Z',
    countries: ['EC'],
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [west, -3],
            [east, -3],
            [east, -2],
            [west, -2],
            [west, -3],
          ],
        ],
      ],
    },
  });
  const parish = (cantonCode: string, lng: number): ParishPoint => ({
    code: `${cantonCode}50`,
    name: 'Parroquia',
    cantonCode,
    canton: `Cantón ${cantonCode}`,
    province: 'Guayas',
    kind: 'rural',
    lat: -2.5,
    lng,
  });

  it('toma el nivel más alto entre las parroquias del cantón y deja fuera lo que no toca ninguna zona', () => {
    const areas = [square('likely', -80, -79), square('highly_likely', -79.5, -79)];
    const result = cantonsInZones(areas, [parish('0901', -79.8), parish('0901', -79.2), parish('0902', -79.8), parish('0903', -70)]);
    expect(result.map(({ code, likelihood }) => [code, likelihood]).sort()).toEqual([
      ['0901', 'highly_likely'],
      ['0902', 'likely'],
    ]);
  });
});
