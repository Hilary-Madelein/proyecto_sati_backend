import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { LogNotificationChannel } from './channels/log.channel.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [DiscoveryModule],
  providers: [NotificationsService, LogNotificationChannel],
})
export class NotificationsModule {}
