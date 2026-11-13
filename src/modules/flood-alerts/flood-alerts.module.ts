import { Module } from '@nestjs/common';
import { TelegramClient } from '../../integrations/telegram/telegram.client.js';
import { CantonAnalysisModule } from '../canton-analysis/canton-analysis.module.js';
import { FloodHubModule } from '../flood-hub/flood-hub.module.js';
import { SituationAnalysisModule } from '../situation-analysis/situation-analysis.module.js';
import { WeatherStationsModule } from '../weather-stations/weather-stations.module.js';
import { CantonCatalog } from './canton-catalog.js';
import { FloodAlertsService } from './flood-alerts.service.js';
import { TelegramBotService } from './telegram-bot.service.js';

/**
 * Prueba de alertas de crecidas repentinas de Google por Telegram. Sin
 * TELEGRAM_BOT_TOKEN no se enciende nada. Va aparte de NotificationsModule, que
 * trabaja con eventos de la SNGR y suscriptores por correo.
 */
@Module({
  imports: [FloodHubModule, CantonAnalysisModule, WeatherStationsModule, SituationAnalysisModule],
  providers: [TelegramClient, CantonCatalog, FloodAlertsService, TelegramBotService],
})
export class FloodAlertsModule {}
