import { Global, Module } from '@nestjs/common';
import { StationRainArchive, WeatherStationSource } from '../../modules/weather-stations/weather-station-source.js';
import { InamhiRainArchive } from './inamhi-rain-archive.js';
import { InamhiStationSource } from './inamhi-station.source.js';

/** Integración con las estaciones del INAMHI: su API (lista y lluvia reciente) y nuestro archivo de lluvia horaria. */
@Global()
@Module({
  providers: [
    { provide: WeatherStationSource, useClass: InamhiStationSource },
    { provide: StationRainArchive, useClass: InamhiRainArchive },
  ],
  exports: [WeatherStationSource, StationRainArchive],
})
export class InamhiStationsModule {}
