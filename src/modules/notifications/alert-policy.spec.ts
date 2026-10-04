import type { HazardEventEntity } from '../events/entities/hazard-event.entity.js';
import { alertForCreated, alertForUpdated } from './alert-policy.js';

const now = new Date('2026-10-02T15:00:00Z');

const makeEvent = (overrides: Partial<HazardEventEntity> = {}): HazardEventEntity =>
  ({
    id: 'e1',
    hazardType: 'flood',
    severity: 'critical',
    status: 'open',
    title: 'Inundación en Babahoyo',
    description: null,
    province: 'Los Ríos',
    canton: 'Babahoyo',
    occurredAt: new Date('2026-10-02T10:00:00Z'),
    affected: 150,
    housesAffected: 30,
    evacuated: 10,
    deceased: 0,
    ...overrides,
  }) as HazardEventEntity;

describe('alertForCreated', () => {
  it('alerta un evento nuevo, abierto, grave y reciente', () => {
    const alert = alertForCreated({ event: makeEvent() }, now);
    expect(alert?.reason).toBe('new');
    expect(alert?.subject).toBe('[Crítico] Inundación — Babahoyo, Los Ríos');
  });

  it.each([
    ['moderado', { severity: 'moderate' as const }],
    ['cerrado', { status: 'closed' as const }],
    ['antiguo (carga inicial)', { occurredAt: new Date('2026-09-20T10:00:00Z') }],
  ])('no alerta un evento %s', (_case, overrides) => {
    expect(alertForCreated({ event: makeEvent(overrides) }, now)).toBeNull();
  });
});

describe('alertForUpdated', () => {
  it('alerta cuando un evento sube a una severidad grave', () => {
    const alert = alertForUpdated({ event: makeEvent(), previous: { severity: 'moderate', status: 'open' } }, now);
    expect(alert?.reason).toBe('escalated');
  });

  it('no alerta si la severidad no sube', () => {
    expect(alertForUpdated({ event: makeEvent(), previous: { severity: 'critical', status: 'open' } }, now)).toBeNull();
  });
});
