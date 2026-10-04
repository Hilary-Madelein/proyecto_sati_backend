import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';
import { HydrologyService } from './hydrology.service.js';

class RiverAtQuery {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

@ApiTags('Ríos (caudales)')
@Controller('rivers')
export class HydrologyController {
  constructor(private readonly hydrology: HydrologyService) {}

  @Get('alerts')
  @ApiOperation({ summary: 'Tramos de río con alerta por caudal alto, por día del pronóstico más reciente' })
  alerts() {
    return this.hydrology.getAlerts();
  }

  @Get('at')
  @ApiOperation({ summary: 'Tramo de río más cercano a un punto (y su alerta, si tiene)' })
  riverAt(@Query() query: RiverAtQuery) {
    return this.hydrology.findRiverAt(query.lat, query.lng);
  }

  @Get(':riverId/forecast')
  @ApiOperation({ summary: 'Pronóstico de caudal de un tramo de río (ensamble y alta resolución)' })
  forecast(@Param('riverId', ParseIntPipe) riverId: number) {
    return this.hydrology.getForecast(riverId);
  }
}
