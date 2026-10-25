import { Module } from '@nestjs/common';
import { RiskLayersController } from './risk-layers.controller.js';
import { RiskLayersService } from './risk-layers.service.js';

/** Capas por componente de la gestión del riesgo: servicios de ArcGIS (SNGR, MTOP, MSP, MINEDUC) y GeoJSON propios. */
@Module({
  controllers: [RiskLayersController],
  providers: [RiskLayersService],
  // Lo usa el análisis por cantón.
  exports: [RiskLayersService],
})
export class RiskLayersModule {}
