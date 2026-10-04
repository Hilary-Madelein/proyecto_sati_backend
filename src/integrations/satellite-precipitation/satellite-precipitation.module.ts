import { Module } from '@nestjs/common';
import { SatellitePrecipitationLayersProvider } from './satellite-precipitation-layers.provider.js';

/** Integración con la lluvia observada por satélite del GeoServer del INAMHI (IMERG, PERSIANN). */
@Module({
  providers: [SatellitePrecipitationLayersProvider],
})
export class SatellitePrecipitationModule {}
