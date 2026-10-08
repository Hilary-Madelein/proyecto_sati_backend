import { Global, Module } from '@nestjs/common';
import { SeaTemperatureSource } from '../../modules/sea-temperature/sea-temperature-source.js';
import { NoaaOisstSource } from './noaa-oisst.source.js';

/** Integración con la temperatura superficial del mar de NOAA (OISST: archivos de NCEI, con ERDDAP de respaldo). */
@Global()
@Module({
  providers: [{ provide: SeaTemperatureSource, useClass: NoaaOisstSource }],
  exports: [SeaTemperatureSource],
})
export class NoaaOisstModule {}
