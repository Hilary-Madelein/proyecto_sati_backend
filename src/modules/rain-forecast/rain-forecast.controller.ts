import { BadRequestException, Controller, Get, Param, ParseIntPipe, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACCUMULATION_HOURS, RainForecastService, type AccumulationHours } from './rain-forecast.service.js';

function toHours(value: number): AccumulationHours {
  if (!ACCUMULATION_HOURS.includes(value as AccumulationHours)) {
    throw new BadRequestException(`Las horas deben ser ${ACCUMULATION_HOURS.join(', ')}`);
  }
  return value as AccumulationHours;
}

@ApiTags('Lluvia pronosticada')
@Controller('rain-forecast')
export class RainForecastController {
  constructor(private readonly rain: RainForecastService) {}

  @Get()
  @ApiOperation({ summary: 'Corrida vigente y qué acumulados (24/48/72 h) están disponibles' })
  availability() {
    return this.rain.availability();
  }

  @Get('accumulated/:hours')
  @ApiOperation({ summary: 'Lluvia acumulada pronosticada: ventana, límites y ruta de la imagen' })
  accumulated(@Param('hours', ParseIntPipe) hours: number) {
    return this.rain.accumulated(toHours(hours));
  }

  @Get('accumulated/:hours/image')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'Imagen PNG de la lluvia acumulada, lista para superponer en el mapa' })
  async image(
    @Param('hours', ParseIntPipe) hours: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const png = await this.rain.image(toHours(hours));
    // La URL lleva la corrida: la imagen de una corrida no cambia.
    response.setHeader('Cache-Control', 'public, max-age=21600');
    return new StreamableFile(png, { type: 'image/png' });
  }
}
