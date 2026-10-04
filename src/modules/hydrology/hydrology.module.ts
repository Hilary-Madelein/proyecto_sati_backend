import { Module } from '@nestjs/common';
import { HydrologyController } from './hydrology.controller.js';
import { HydrologyService } from './hydrology.service.js';

/**
 * Caudales y alertas de ríos. RiverForecastSource y RiverAlertSource los
 * aportan las integraciones (hoy: GEOGLOWS e Hydroviewer del INAMHI).
 */
@Module({
  controllers: [HydrologyController],
  providers: [HydrologyService],
})
export class HydrologyModule {}
