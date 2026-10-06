import { Injectable } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { DiscoveryService } from '@nestjs/core';
import type { HazardEventEntity } from '../events/entities/hazard-event.entity.js';
import { InMemoryDeliveryStore, InMemorySubscriberStore } from '../../storage/memory/in-memory-notification.stores.js';
import { NotificationSubscriberEntity } from './entities/notification-subscriber.entity.js';
import { MailSender, type MailMessage } from './mail-sender.js';
import type { HazardAlert, NotificationChannelAdapter, NotificationRecipient } from './notification-channel.js';
import { NotificationsService } from './notifications.service.js';

const event = (overrides: Partial<HazardEventEntity> = {}) =>
  ({ id: 'e1', severity: 'critical', status: 'open', province: 'Los Rios', title: 'Inundación', ...overrides }) as HazardEventEntity;

const alert = (overrides: Partial<HazardEventEntity> = {}): HazardAlert => ({
  key: `e1:new:${overrides.severity ?? 'critical'}`,
  reason: 'new',
  event: event(overrides),
  subject: '[Crítico] Inundación — Babahoyo, Los Rios',
  message: 'Nuevo evento',
});

class FakeChannel implements NotificationChannelAdapter {
  readonly name = 'email';
  readonly sent: string[] = [];
  failFor = new Set<string>();

  async send(_alert: HazardAlert, recipient: NotificationRecipient) {
    if (this.failFor.has(recipient.email)) throw new Error('buzón lleno');
    this.sent.push(recipient.email);
  }
}

class FakeMail extends MailSender {
  readonly delivers = true;
  readonly messages: MailMessage[] = [];
  async send(message: MailMessage) {
    this.messages.push(message);
  }
}

async function build() {
  const subscribers = new InMemorySubscriberStore();
  const deliveries = new InMemoryDeliveryStore();
  const channel = new FakeChannel();
  const mail = new FakeMail();
  const discovery = { getProviders: () => [{ instance: channel }] } as unknown as DiscoveryService;
  const service = new NotificationsService(discovery, subscribers, deliveries, mail);
  service.onApplicationBootstrap();

  const add = (email: string, fields: Partial<NotificationSubscriberEntity> = {}) =>
    subscribers.save(
      Object.assign(new NotificationSubscriberEntity(), { name: email, email, provinces: [], minSeverity: 'high', active: true, ...fields }),
    );
  return { service, subscribers, deliveries, channel, mail, add };
}

describe('NotificationsService.dispatch', () => {
  it('envía solo a los suscriptores interesados y registra cada envío', async () => {
    const { service, channel, deliveries, add } = await build();
    await add('rios@x.ec', { provinces: ['Los Ríos'] });
    await add('pais@x.ec');
    await add('loja@x.ec', { provinces: ['Loja'] });
    await add('pausado@x.ec', { active: false });

    const result = await service.dispatch(alert());

    expect(channel.sent.sort()).toEqual(['pais@x.ec', 'rios@x.ec']);
    expect(result).toEqual({ recipients: 2, sent: 2, failed: 0, skipped: 0 });
    expect((await deliveries.list({ limit: 10, offset: 0 })).total).toBe(2);
  });

  it('no repite un aviso ya enviado (p. ej. tras un reinicio)', async () => {
    const { service, channel, add } = await build();
    await add('pais@x.ec');

    await service.dispatch(alert());
    const second = await service.dispatch(alert());

    expect(channel.sent).toEqual(['pais@x.ec']);
    expect(second).toMatchObject({ sent: 0, skipped: 1 });
  });

  it('un envío fallido queda registrado, no detiene a los demás y no lanza error', async () => {
    const { service, channel, deliveries, add } = await build();
    await add('malo@x.ec');
    await add('bueno@x.ec');
    channel.failFor.add('malo@x.ec');

    const result = await service.dispatch(alert());

    expect(result).toMatchObject({ sent: 1, failed: 1 });
    const { items } = await deliveries.list({ limit: 10, offset: 0 });
    expect(items.find((item) => item.recipient === 'malo@x.ec')).toMatchObject({ status: 'failed', error: 'buzón lleno' });
  });

  it('reintenta un aviso que antes falló', async () => {
    const { service, channel, add } = await build();
    await add('malo@x.ec');
    channel.failFor.add('malo@x.ec');
    await service.dispatch(alert());

    channel.failFor.clear();
    const retry = await service.dispatch(alert());
    expect(retry).toMatchObject({ sent: 1, skipped: 0 });
  });
});

describe('NotificationsService.sendTest', () => {
  it('envía un correo de prueba y lo registra en el historial', async () => {
    const { service, mail, deliveries } = await build();
    const result = await service.sendTest({ name: 'Ana <b>', email: 'ana@x.ec' });

    expect(result).toEqual({ status: 'sent', delivered: true, error: null });
    expect(mail.messages[0]).toMatchObject({ to: 'ana@x.ec', subject: 'SATI.EC · Correo de prueba' });
    expect(mail.messages[0].html).toContain('Ana &lt;b&gt;');
    expect((await deliveries.list({ limit: 10, offset: 0 })).items[0]).toMatchObject({ channel: 'email', eventId: null });
  });
});

describe('emitAsync espera a los listeners con promisify', () => {
  @Injectable()
  class SlowListener {
    done = false;
    @OnEvent('prueba', { promisify: true })
    async handle() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      this.done = true;
    }
  }

  it('la sincronización no termina antes que las notificaciones', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EventEmitterModule.forRoot()], providers: [SlowListener] }).compile();
    await moduleRef.init();

    await moduleRef.get(EventEmitter2).emitAsync('prueba');

    expect(moduleRef.get(SlowListener).done).toBe(true);
    await moduleRef.close();
  });
});
