import { Global, Module } from '@nestjs/common';
import { RiverForecastArchive, RiverForecastSource } from '../../modules/hydrology/river-sources.js';
import { GeoglowsArchiveSource } from './geoglows-archive.source.js';
import { GeoglowsForecastSource } from './geoglows-forecast.source.js';

/** Integración con GEOGLOWS: pronóstico de caudal por tramo de río y archivo de corridas pasadas. */
@Global()
@Module({
  providers: [
    { provide: RiverForecastSource, useClass: GeoglowsForecastSource },
    { provide: RiverForecastArchive, useClass: GeoglowsArchiveSource },
  ],
  exports: [RiverForecastSource, RiverForecastArchive],
})
export class GeoglowsModule {}
