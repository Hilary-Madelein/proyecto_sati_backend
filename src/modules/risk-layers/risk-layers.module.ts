import { Module } from '@nestjs/common';
import { RiskLayersController } from './risk-layers.controller.js';
import { RiskLayersService } from './risk-layers.service.js';
import { RiskTileLayersProvider } from './risk-tile-layers.provider.js';

/** Capas por componente de la gestión del riesgo: servicios de ArcGIS (SNGR, MIT, MSP, MINEDUC) y GeoJSON propios. */
@Module({
  controllers: [RiskLayersController],
  // RiskTileLayersProvider: capas solo en teselas vectoriales (red vial provincial), servidas por /layers.
  providers: [RiskLayersService, RiskTileLayersProvider],
  // Lo usa el análisis por cantón.
  exports: [RiskLayersService],
})
export class RiskLayersModule {}
