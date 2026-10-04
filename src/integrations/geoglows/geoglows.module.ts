import { Global, Module } from '@nestjs/common';
import { RiverForecastSource } from '../../modules/hydrology/river-sources.js';
import { GeoglowsForecastSource } from './geoglows-forecast.source.js';

/** Integración con la API pública de GEOGLOWS: pronóstico de caudal por tramo de río. */
@Global()
@Module({
  providers: [{ provide: RiverForecastSource, useClass: GeoglowsForecastSource }],
  exports: [RiverForecastSource],
})
export class GeoglowsModule {}
