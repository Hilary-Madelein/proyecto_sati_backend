import { Module } from '@nestjs/common';
import { RiskLayersController } from './risk-layers.controller.js';
import { RiskLayersService } from './risk-layers.service.js';

/** Capas por componente de la gestión del riesgo: servicios de ArcGIS (SNGR, MTOP, MSP, MINEDUC) y GeoJSON propios. */
@Module({
  controllers: [RiskLayersController],
  providers: [RiskLayersService],
})
export class RiskLayersModule {}
