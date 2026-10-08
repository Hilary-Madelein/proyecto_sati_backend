import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { escapeHtml } from '../../common/text/escape-html.js';
import { DiscoveryService } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HazardEventTopics,
  type HazardEventCreated,
  type HazardEventUpdated,
} from '../events/domain/hazard-event.events.js';
import { alertForCreated, alertForUpdated } from './alert-policy.js';
import { NotificationDeliveryEntity } from './entities/notification-delivery.entity.js';
import { MailSender } from './mail-sender.js';
import {
  NotificationChannel,
  type HazardAlert,
  type NotificationChannelAdapter,
  type NotificationRecipient,
} from './notification-channel.js';
import { DeliveryStore, SubscriberStore } from './notification-stores.js';
import { subscriberWantsAlert } from './subscriber-matching.js';

export interface TestResult {
  status: 'sent' | 'failed';
  /** false = no hay SMTP configurado: el correo solo se escribió en el log. */
  delivered: boolean;
  error: string | null;
}

export interface DispatchResult {
  recipients: number;
  sent: number;
  failed: number;
  /** Ya se habían enviado antes (p. ej. el mismo aviso tras un reinicio). */
  skipped: number;
}

/**
 * Decide a quién avisar y envía. Escucha los avisos internos de eventos
 * (`hazard-event.*`), aplica la regla de alertas, filtra a los suscriptores
 * interesados y envía por cada canal. Cada envío queda en el historial, que
 * además evita repetir el mismo aviso. Nunca lanza errores: un correo que
 * falla no debe detener la sincronización de eventos.
 */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsService.name);
  private channels: NotificationChannelAdapter[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly subscribers: SubscriberStore,
    private readonly deliveries: DeliveryStore,
    private readonly mail: MailSender,
  ) {}

  onApplicationBootstrap(): void {
    this.channels = this.discovery
      .getProviders({ metadataKey: NotificationChannel.KEY })
      .map((wrapper) => wrapper.instance as NotificationChannelAdapter | undefined)
      .filter((channel): channel is NotificationChannelAdapter => Boolean(channel));
    this.logger.log(`Canales de notificación: ${this.channels.map((channel) => channel.name).join(', ') || 'ninguno'}`);
    if (!this.mail.delivers) {
      this.logger.warn('Sin servidor de correo (SMTP_HOST): los correos solo se escriben en el log');
    }
  }

  // `promisify`: así `emitAsync` espera a que terminen los envíos (necesario en
  // plataformas sin servidor, donde la función se apaga al responder).
  @OnEvent(HazardEventTopics.created, { promisify: true })
  async onCreated(payload: HazardEventCreated): Promise<void> {
    const alert = alertForCreated(payload);
    if (alert) await this.dispatch(alert);
  }

  @OnEvent(HazardEventTopics.updated, { promisify: true })
  async onUpdated(payload: HazardEventUpdated): Promise<void> {
    const alert = alertForUpdated(payload);
    if (alert) await this.dispatch(alert);
  }

  /** Envía la alerta a cada suscriptor interesado, por cada canal. */
  async dispatch(alert: HazardAlert): Promise<DispatchResult> {
    const result: DispatchResult = { recipients: 0, sent: 0, failed: 0, skipped: 0 };
    try {
      const interested = (await this.subscribers.listActive()).filter((subscriber) => subscriberWantsAlert(subscriber, alert));
      result.recipients = interested.length;

      // En serie: son pocos destinatarios y así no se satura el servidor de correo.
      for (const subscriber of interested) {
        const recipient: NotificationRecipient = {
          subscriberId: subscriber.id,
          name: subscriber.name,
          email: subscriber.email,
          provinces: subscriber.provinces,
        };
        for (const channel of this.channels) {
          const { outcome } = await this.deliver(alert.key, alert.subject, alert.event.id, channel, recipient, () =>
            channel.send(alert, recipient),
          );
          result[outcome]++;
        }
      }

      this.logger.log(
        `${alert.subject}: ${result.recipients} destinatarios · ${result.sent} enviados · ${result.failed} fallidos · ${result.skipped} ya enviados`,
      );
    } catch (error) {
      this.logger.error(`No se pudo procesar la alerta "${alert.subject}": ${(error as Error).message}`);
    }
    return result;
  }

  /** Correo de prueba para verificar la configuración del servidor de correo. */
  async sendTest(recipient: { name: string; email: string }): Promise<TestResult> {
    const subject = 'SATI.EC · Correo de prueba';
    const text = `Hola, ${recipient.name}:\n\nEste es un correo de prueba de SATI.EC. Si lo recibes, el envío de alertas está bien configurado.`;
    const html = `<p>Hola, ${escapeHtml(recipient.name)}:</p><p>Este es un correo de prueba de <strong>SATI.EC</strong>. Si lo recibes, el envío de alertas está bien configurado.</p>`;

    const { outcome, error } = await this.deliver(
      `test:${new Date().toISOString()}`,
      subject,
      null,
      { name: 'email' },
      { subscriberId: null, name: recipient.name, email: recipient.email, provinces: [] },
      () => this.mail.send({ to: recipient.email, subject, text, html }),
      { force: true },
    );
    return { status: outcome === 'failed' ? 'failed' : 'sent', delivered: this.mail.delivers, error };
  }

  /** Envía una vez (si no se envió antes) y lo registra en el historial. */
  private async deliver(
    alertKey: string,
    subject: string,
    eventId: string | null,
    channel: Pick<NotificationChannelAdapter, 'name'>,
    recipient: NotificationRecipient,
    send: () => Promise<void>,
    options: { force?: boolean } = {},
  ): Promise<{ outcome: 'sent' | 'failed' | 'skipped'; error: string | null }> {
    if (!options.force && (await this.deliveries.wasSent(alertKey, channel.name, recipient.email))) {
      return { outcome: 'skipped', error: null };
    }

    let error: string | null = null;
    try {
      await send();
    } catch (caught) {
      error = (caught as Error).message || 'error desconocido';
      this.logger.error(`No se pudo enviar "${subject}" a ${recipient.email} por ${channel.name}: ${error}`);
    }

    await this.deliveries.record(
      Object.assign(new NotificationDeliveryEntity(), {
        alertKey,
        eventId,
        subscriberId: recipient.subscriberId,
        recipient: recipient.email,
        channel: channel.name,
        subject: subject.slice(0, 255),
        status: error ? 'failed' : 'sent',
        error,
      }),
    );
    return { outcome: error ? 'failed' : 'sent', error };
  }
}
