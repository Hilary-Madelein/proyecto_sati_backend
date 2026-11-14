import { Module } from '@nestjs/common';
import { IocSeaLevelClient } from '../../integrations/ioc-sea-level/ioc-sea-level.client.js';
import { TelegramClient } from '../../integrations/telegram/telegram.client.js';
import { WeatherStationsModule } from '../weather-stations/weather-stations.module.js';
import { GalapagosAlertsService } from './galapagos-alerts.service.js';
import { GalapagosRainController } from './galapagos-rain.controller.js';
import { GalapagosRainService } from './galapagos-rain.service.js';
import { GalapagosSeaService } from './galapagos-sea.service.js';

/**
 * Lluvia y alarma solo para Galápagos, con sus dos estaciones (M0191 y M0221) y
 * umbrales propios. La alarma va por Telegram a quienes siguen todo el país, la
 * provincia o el cantón; sin TELEGRAM_BOT_TOKEN solo queda la consulta. La lluvia se
 * cruza con el nivel del mar (mareógrafo de Santa Cruz): ver galapagos-sea.ts.
 */
@Module({
  imports: [WeatherStationsModule],
  controllers: [GalapagosRainController],
  providers: [TelegramClient, IocSeaLevelClient, GalapagosSeaService, GalapagosRainService, GalapagosAlertsService],
})
export class GalapagosRainModule {}
