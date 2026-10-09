import { BadRequestException, Controller, Get, Param, ParseFloatPipe, ParseIntPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { FORECAST_DAYS, RainForecastService, type ForecastDay } from './rain-forecast.service.js';

function toDay(value: number): ForecastDay {
  if (!FORECAST_DAYS.includes(value as ForecastDay)) {
    throw new BadRequestException(`El día debe ser ${FORECAST_DAYS.join(', ')}`);
  }
  return value as ForecastDay;
}

@ApiTags('Lluvia pronosticada')
@Controller('rain-forecast')
export class RainForecastController {
  constructor(private readonly rain: RainForecastService) {}

  @Get()
  @ApiOperation({ summary: 'Corrida vigente y qué días (1, 2, 3) están disponibles' })
  availability() {
    return this.rain.availability();
  }

  @Get('days/:day')
  @ApiOperation({ summary: 'Lluvia pronosticada de un solo día: ventana, límites, máximo y ruta de la imagen' })
  daily(@Param('day', ParseIntPipe) day: number) {
    return this.rain.daily(toDay(day));
  }

  @Get('days/:day/value')
  @ApiOperation({ summary: 'Lluvia pronosticada del día en un punto (mm); mm es null fuera del Ecuador o sin dato' })
  value(
    @Param('day', ParseIntPipe) day: number,
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
  ) {
    return this.rain.valueAt(toDay(day), lat, lng);
  }

  @Get('days/:day/image')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'Imagen PNG de la lluvia pronosticada del día, lista para superponer en el mapa' })
  async image(@Param('day', ParseIntPipe) day: number, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const png = await this.rain.image(toDay(day));
    // La URL lleva la corrida y el fin de la ventana del día: esa imagen no cambia.
    response.setHeader('Cache-Control', 'public, max-age=21600');
    return new StreamableFile(png, { type: 'image/png' });
  }
}
