import { Module } from '@nestjs/common';
import { RainForecastController } from './rain-forecast.controller.js';
import { RainForecastService } from './rain-forecast.service.js';

/** Lluvia pronosticada acumulada. RainForecastSource lo aporta la integración (hoy: WRF del INAMHI). */
@Module({
  controllers: [RainForecastController],
  providers: [RainForecastService],
})
export class RainForecastModule {}
