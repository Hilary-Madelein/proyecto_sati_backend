import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HazardEventTopics,
  type HazardEventCreated,
  type HazardEventUpdated,
} from '../events/domain/hazard-event.events.js';
import { alertForCreated, alertForUpdated } from './alert-policy.js';
import { NotificationChannel, type HazardAlert, type NotificationChannelAdapter } from './notification-channel.js';

@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsService.name);
  private channels: NotificationChannelAdapter[] = [];

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    this.channels = this.discovery
      .getProviders({ metadataKey: NotificationChannel.KEY })
      .map((wrapper) => wrapper.instance as NotificationChannelAdapter | undefined)
      .filter((channel): channel is NotificationChannelAdapter => Boolean(channel));
    this.logger.log(`Canales de notificación: ${this.channels.map((channel) => channel.name).join(', ') || 'ninguno'}`);
  }

  @OnEvent(HazardEventTopics.created, { async: true })
  async onCreated(payload: HazardEventCreated): Promise<void> {
    const alert = alertForCreated(payload);
    if (alert) await this.dispatch(alert);
  }

  @OnEvent(HazardEventTopics.updated, { async: true })
  async onUpdated(payload: HazardEventUpdated): Promise<void> {
    const alert = alertForUpdated(payload);
    if (alert) await this.dispatch(alert);
  }

  /** Envía por todos los canales; si uno falla, los demás siguen. */
  private async dispatch(alert: HazardAlert): Promise<void> {
    const results = await Promise.allSettled(this.channels.map((channel) => channel.send(alert)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(`El canal "${this.channels[index].name}" no pudo enviar la alerta: ${String(result.reason)}`);
      }
    });
  }
}
