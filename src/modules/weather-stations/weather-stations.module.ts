import { Module } from '@nestjs/common';
import { WeatherStationsController } from './weather-stations.controller.js';
import { WeatherStationsService } from './weather-stations.service.js';

/** Lluvia medida en estaciones. WeatherStationSource lo aporta la integración (hoy: API del INAMHI). */
@Module({
  controllers: [WeatherStationsController],
  providers: [WeatherStationsService],
})
export class WeatherStationsModule {}
