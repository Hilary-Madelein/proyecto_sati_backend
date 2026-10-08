import { Global, Module } from '@nestjs/common';
import { ObservedRainSource } from '../../modules/observed-rain/observed-rain-source.js';
import { SatelliteObservedRainSource } from './satellite-observed-rain.source.js';
import { SatellitePrecipitationLayersProvider } from './satellite-precipitation-layers.provider.js';

/**
 * Integración con la lluvia observada por satélite del GeoServer del INAMHI
 * (PERSIANN): capas WMS (catálogo y leyendas) y lluvia horaria en grilla (WCS).
 */
@Global()
@Module({
  providers: [SatellitePrecipitationLayersProvider, { provide: ObservedRainSource, useClass: SatelliteObservedRainSource }],
  exports: [ObservedRainSource],
})
export class SatellitePrecipitationModule {}
