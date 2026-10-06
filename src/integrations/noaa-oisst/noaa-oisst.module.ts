import { Global, Module } from '@nestjs/common';
import { SeaTemperatureSource } from '../../modules/sea-temperature/sea-temperature-source.js';
import { NoaaOisstSource } from './noaa-oisst.source.js';

/** Integración con la temperatura superficial del mar de NOAA (OISST, servidor ERDDAP de CoastWatch). */
@Global()
@Module({
  providers: [{ provide: SeaTemperatureSource, useClass: NoaaOisstSource }],
  exports: [SeaTemperatureSource],
})
export class NoaaOisstModule {}
