import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WeatherStationsService } from './weather-stations.service.js';

@ApiTags('Estaciones')
@Controller('weather-stations')
export class WeatherStationsController {
  constructor(private readonly stations: WeatherStationsService) {}

  @Get()
  @ApiOperation({ summary: 'Estaciones que transmiten, con la lluvia medida en cada hora reciente (mm)' })
  snapshot() {
    return this.stations.snapshot();
  }
}
