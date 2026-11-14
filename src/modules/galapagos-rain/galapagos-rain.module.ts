import { Module } from '@nestjs/common';
import { TelegramClient } from '../../integrations/telegram/telegram.client.js';
import { WeatherStationsModule } from '../weather-stations/weather-stations.module.js';
import { GalapagosAlertsService } from './galapagos-alerts.service.js';
import { GalapagosRainController } from './galapagos-rain.controller.js';
import { GalapagosRainService } from './galapagos-rain.service.js';

/**
 * Lluvia y alarma solo para Galápagos, con sus dos estaciones (M0191 y M0221) y
 * umbrales propios. La alarma va por Telegram a quienes siguen todo el país, la
 * provincia o el cantón; sin TELEGRAM_BOT_TOKEN solo queda la consulta.
 */
@Module({
  imports: [WeatherStationsModule],
  controllers: [GalapagosRainController],
  providers: [TelegramClient, GalapagosRainService, GalapagosAlertsService],
})
export class GalapagosRainModule {}
