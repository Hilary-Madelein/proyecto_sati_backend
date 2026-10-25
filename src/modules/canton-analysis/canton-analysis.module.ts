import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { FloodHubModule } from '../flood-hub/flood-hub.module.js';
import { HydrologyModule } from '../hydrology/hydrology.module.js';
import { ObservedRainModule } from '../observed-rain/observed-rain.module.js';
import { RainForecastModule } from '../rain-forecast/rain-forecast.module.js';
import { RiskLayersModule } from '../risk-layers/risk-layers.module.js';
import { WeatherStationsModule } from '../weather-stations/weather-stations.module.js';
import { CantonAnalysisController } from './canton-analysis.controller.js';
import { CantonAnalysisService } from './canton-analysis.service.js';

/** Semáforo de lluvia de 12 h por cantón, con lo que hay en cada uno (cruza los demás módulos). */
@Module({
  imports: [
    WeatherStationsModule,
    ObservedRainModule,
    RainForecastModule,
    HydrologyModule,
    FloodHubModule,
    EventsModule,
    RiskLayersModule,
  ],
  controllers: [CantonAnalysisController],
  providers: [CantonAnalysisService],
})
export class CantonAnalysisModule {}
