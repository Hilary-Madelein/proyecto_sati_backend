import { Global, Module } from '@nestjs/common';
import { RiverAlertSource } from '../../modules/hydrology/river-sources.js';
import { HydroviewerAlertsSource } from './hydroviewer-alerts.source.js';
import { HydroviewerLayersProvider } from './hydroviewer-layers.provider.js';

/** Integración con el Hydroviewer del INAMHI: alertas por caudal y red de ríos. */
@Global()
@Module({
  providers: [{ provide: RiverAlertSource, useClass: HydroviewerAlertsSource }, HydroviewerLayersProvider],
  exports: [RiverAlertSource],
})
export class InamhiHydroviewerModule {}
