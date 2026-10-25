import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { FloodHubModule } from '../flood-hub/flood-hub.module.js';
import { HydrologyModule } from '../hydrology/hydrology.module.js';
import { RainForecastModule } from '../rain-forecast/rain-forecast.module.js';
import { RiskLayersModule } from '../risk-layers/risk-layers.module.js';
import { CantonAnalysisController } from './canton-analysis.controller.js';
import { CantonAnalysisService } from './canton-analysis.service.js';

/** Semáforo por cantón con la lluvia pronosticada de 12 y 24 h, con lo que hay en cada uno (cruza los demás módulos). */
@Module({
  imports: [
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
