import { Module } from '@nestjs/common';
import { FloodHubController } from './flood-hub.controller.js';
import { FloodHubService } from './flood-hub.service.js';

/** Pronóstico de Google Flood Hub. FloodHubSource lo aporta la integración (hoy: GeoJSON del demo GDE-Niño). */
@Module({
  controllers: [FloodHubController],
  providers: [FloodHubService],
  // Lo usa el análisis por cantón.
  exports: [FloodHubService],
})
export class FloodHubModule {}
