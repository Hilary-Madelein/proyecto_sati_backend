import { Global, Module } from '@nestjs/common';
import { WeatherStationSource } from '../../modules/weather-stations/weather-station-source.js';
import { InamhiStationSource } from './inamhi-station.source.js';

/** Integración con la API de estaciones del INAMHI: lista de estaciones y lluvia horaria reciente. */
@Global()
@Module({
  providers: [{ provide: WeatherStationSource, useClass: InamhiStationSource }],
  exports: [WeatherStationSource],
})
export class InamhiStationsModule {}
