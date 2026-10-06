import { ConflictException, BadRequestException } from '@nestjs/common';
import { toOfficialProvince } from '../../common/geo/ecuador-provinces.js';
import type { HazardEventEntity } from '../events/entities/hazard-event.entity.js';
import { InMemorySubscriberStore } from '../../storage/memory/in-memory-notification.stores.js';
import { buildAlertEmail } from './channels/alert-email.js';
import { NotificationSubscriberEntity } from './entities/notification-subscriber.entity.js';
import type { HazardAlert } from './notification-channel.js';
import { subscriberWantsAlert } from './subscriber-matching.js';
import { SubscribersService } from './subscribers.service.js';

const subscriber = (fields: Partial<NotificationSubscriberEntity>) =>
  Object.assign(new NotificationSubscriberEntity(), { name: 'Ana', email: 'ana@x.ec', provinces: [], minSeverity: 'high', active: true, ...fields });

const alert = (event: Partial<HazardEventEntity>): HazardAlert => ({
  key: 'k',
  reason: 'new',
  event: { id: 'e1', severity: 'critical', province: 'Los Rios', occurredAt: new Date('2026-10-02T15:40:00Z'), ...event } as HazardEventEntity,
  subject: '[Crítico] Inundación — Babahoyo, Los Rios',
  message: 'Nuevo evento crítico: Inundación <script>.\nLugar: Babahoyo.',
});

describe('toOfficialProvince', () => {
  it.each([
    ['LOS RIOS', 'Los Ríos'],
    ['santo domingo de los tsachilas', 'Santo Domingo de los Tsáchilas'],
    ['  Galapagos ', 'Galápagos'],
    ['Atlántida', null],
  ])('%s → %s', (input, expected) => {
    expect(toOfficialProvince(input)).toBe(expected);
  });
});

describe('subscriberWantsAlert', () => {
  it.each([
    ['todo el país', {}, {}, true],
    ['su provincia (sin tildes en la SNGR)', { provinces: ['Los Ríos'] }, {}, true],
    ['otra provincia', { provinces: ['Loja'] }, {}, false],
    ['evento sin provincia y suscriptor con provincias', { provinces: ['Loja'] }, { province: null }, false],
    ['inactivo', { active: false }, {}, false],
    ['alto con mínimo crítico', { minSeverity: 'critical' as const }, { severity: 'high' as const }, false],
    ['crítico con mínimo alto', { minSeverity: 'high' as const }, { severity: 'critical' as const }, true],
  ])('%s → %s', (_case, fields, event, expected) => {
    expect(subscriberWantsAlert(subscriber(fields), alert(event))).toBe(expected);
  });
});

describe('buildAlertEmail', () => {
  const recipient = { subscriberId: 's1', name: 'Ana', email: 'ana@x.ec', provinces: ['Los Ríos'] };

  it('escapa el HTML de los textos de la SNGR y usa la hora de Ecuador', () => {
    const mail = buildAlertEmail(alert({}), recipient, { appUrl: 'https://sati.example' });
    expect(mail.to).toBe('ana@x.ec');
    expect(mail.html).toContain('Inundación &lt;script&gt;.');
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain('10:40');
    expect(mail.text).toContain('Ver en el mapa: https://sati.example');
    expect(mail.text).toContain('para Los Ríos');
  });

  it('sin provincias dice "todo el país" y sin APP_PUBLIC_URL no pone enlace', () => {
    const mail = buildAlertEmail(alert({}), { ...recipient, provinces: [] });
    expect(mail.text).toContain('para todo el país');
    expect(mail.html).not.toContain('Ver en el mapa');
  });
});

describe('SubscribersService', () => {
  const build = () => new SubscribersService(new InMemorySubscriberStore());

  it('guarda las provincias con su nombre oficial y sin repetidos', async () => {
    const created = await build().create({ name: 'Ana', email: 'ana@x.ec', provinces: ['LOS RIOS', 'Los Ríos', 'guayas'] });
    expect(created).toMatchObject({ provinces: ['Los Ríos', 'Guayas'], minSeverity: 'high', active: true });
  });

  it('rechaza provincias que no existen', async () => {
    await expect(build().create({ name: 'Ana', email: 'ana@x.ec', provinces: ['Atlántida'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no permite dos suscriptores con el mismo correo', async () => {
    const service = build();
    await service.create({ name: 'Ana', email: 'ana@x.ec' });
    await expect(service.create({ name: 'Otra', email: 'ana@x.ec' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('edita solo los campos enviados', async () => {
    const service = build();
    const { id } = await service.create({ name: 'Ana', email: 'ana@x.ec', provinces: ['Loja'] });
    const updated = await service.update(id, { active: false });
    expect(updated).toMatchObject({ name: 'Ana', provinces: ['Loja'], active: false });
  });
});
