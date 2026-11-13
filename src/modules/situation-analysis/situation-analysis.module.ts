import { Module } from '@nestjs/common';
import { GeminiClient } from '../../integrations/gemini/gemini.client.js';
import { CantonAnalysisModule } from '../canton-analysis/canton-analysis.module.js';
import { EventsModule } from '../events/events.module.js';
import { FloodHubModule } from '../flood-hub/flood-hub.module.js';
import { WeatherStationsModule } from '../weather-stations/weather-stations.module.js';
import { SituationAnalysisController } from './situation-analysis.controller.js';
import { SituationAnalysisService } from './situation-analysis.service.js';

/** Análisis de la situación del momento redactado con Gemini, a pedido desde el visor y desde Telegram. */
@Module({
  imports: [CantonAnalysisModule, WeatherStationsModule, FloodHubModule, EventsModule],
  controllers: [SituationAnalysisController],
  providers: [GeminiClient, SituationAnalysisService],
  // Lo usa el bot de Telegram ("Analizar la situación actual").
  exports: [SituationAnalysisService],
})
export class SituationAnalysisModule {}
