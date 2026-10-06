import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { EmailNotificationChannel } from './channels/email.channel.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { SubscribersService } from './subscribers.service.js';

/**
 * Notificaciones: decide a quién avisar y envía. Los almacenes (SubscriberStore,
 * DeliveryStore) los aporta el almacenamiento y el MailSender, la integración de correo.
 */
@Module({
  imports: [DiscoveryModule, AdminAuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, SubscribersService, EmailNotificationChannel],
})
export class NotificationsModule {}
