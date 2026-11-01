import { Module } from '@nestjs/common';
import { TelegramClient } from '../../integrations/telegram/telegram.client.js';
import { FloodHubModule } from '../flood-hub/flood-hub.module.js';
import { FloodAlertsService } from './flood-alerts.service.js';
import { TelegramBotService } from './telegram-bot.service.js';

/**
 * Prueba de alertas de crecidas repentinas de Google por Telegram. Sin
 * TELEGRAM_BOT_TOKEN no se enciende nada. Va aparte de NotificationsModule, que
 * trabaja con eventos de la SNGR y suscriptores por correo.
 */
@Module({
  imports: [FloodHubModule],
  providers: [TelegramClient, FloodAlertsService, TelegramBotService],
})
export class FloodAlertsModule {}
