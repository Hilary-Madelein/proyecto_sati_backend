import { Global, Module } from '@nestjs/common';
import { ObservedRainSource } from '../../modules/observed-rain/observed-rain-source.js';
import { PardigRainSource } from '../google-pardig/pardig-rain.source.js';
import { CombinedObservedRainSource } from './combined-observed-rain.source.js';
import { SatelliteObservedRainSource } from './satellite-observed-rain.source.js';
import { SatellitePrecipitationLayersProvider } from './satellite-precipitation-layers.provider.js';

/**
 * Lluvia observada por satélite: PERSIANN del GeoServer del INAMHI (capas WMS con
 * catálogo y leyendas, y lluvia horaria en grilla por WCS) y PARDIG de Google
 * (almacén público, en memoria).
 */
@Global()
@Module({
  providers: [
    SatellitePrecipitationLayersProvider,
    SatelliteObservedRainSource,
    PardigRainSource,
    { provide: ObservedRainSource, useClass: CombinedObservedRainSource },
  ],
  exports: [ObservedRainSource],
})
export class SatellitePrecipitationModule {}
