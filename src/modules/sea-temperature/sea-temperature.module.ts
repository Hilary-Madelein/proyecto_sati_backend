import { Module } from '@nestjs/common';
import { SeaTemperatureController } from './sea-temperature.controller.js';
import { SeaTemperatureService } from './sea-temperature.service.js';

/** Temperatura del mar y su anomalía. SeaTemperatureSource lo aporta la integración (hoy: NOAA OISST). */
@Module({
  controllers: [SeaTemperatureController],
  providers: [SeaTemperatureService],
})
export class SeaTemperatureModule {}
