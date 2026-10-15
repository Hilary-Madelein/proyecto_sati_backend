import { alertPersistence, MIN_FORECASTS, withPersistence } from './alert-persistence.js';
import type { AlertLevel, RiverAlert, RiverAlertsSnapshot } from './river.js';

const alert = (riverId: number, dailyLevels: AlertLevel[]): RiverAlert => ({
  riverId,
  latitude: -2.2,
  longitude: -79.9,
  streamOrder: 3,
  province: null,
  canton: null,
  river: null,
  dailyLevels,
  maxLevel: Math.max(0, ...dailyLevels) as AlertLevel,
  alertShare: null,
  persistent: false,
});

const snapshot = (alerts: RiverAlert[]): RiverAlertsSnapshot => ({
  source: 'prueba',
  forecastDate: '2026-10-15',
  days: ['2026-10-15', '2026-10-16'],
  totalReaches: 100,
  persistence: null,
  alerts,
});

describe('alertPersistence', () => {
  it('cuenta solo los pronósticos en que el tramo amaneció con alerta', () => {
    const history = [
      snapshot([alert(1, [2, 0]), alert(2, [0, 5])]),
      snapshot([alert(1, [5, 5])]),
      snapshot([alert(1, [0, 2]), alert(2, [2, 0])]),
      snapshot([]),
    ];
    const { forecasts, shareByRiver } = alertPersistence(history);
    expect(forecasts).toBe(4);
    expect(shareByRiver.get(1)).toBe(0.5);
    expect(shareByRiver.get(2)).toBe(0.25);
  });
});

describe('withPersistence', () => {
  const history = (alertedDays: number, total: number) =>
    Array.from({ length: total }, (_, day) => snapshot(day < alertedDays ? [alert(1, [2])] : []));

  it('marca como persistente el tramo con alerta en el 60 % de los días o más', () => {
    const result = withPersistence(snapshot([alert(1, [2, 2]), alert(2, [5, 0])]), alertPersistence(history(18, 30)));
    expect(result.persistence).toEqual({ forecasts: 30, threshold: 0.6 });
    expect(result.alerts.map(({ riverId, alertShare, persistent }) => ({ riverId, alertShare, persistent }))).toEqual([
      { riverId: 1, alertShare: 0.6, persistent: true },
      { riverId: 2, alertShare: 0, persistent: false },
    ]);
  });

  it('no marca el tramo que alerta menos seguido', () => {
    const result = withPersistence(snapshot([alert(1, [2])]), alertPersistence(history(17, 30)));
    expect(result.alerts[0].persistent).toBe(false);
  });

  it('no marca nada con pocos pronósticos o sin historia', () => {
    const few = withPersistence(snapshot([alert(1, [2])]), alertPersistence(history(5, MIN_FORECASTS - 1)));
    const none = withPersistence(snapshot([alert(1, [2])]), null);
    for (const result of [few, none]) {
      expect(result.persistence).toBeNull();
      expect(result.alerts[0]).toMatchObject({ alertShare: null, persistent: false });
    }
  });
});
