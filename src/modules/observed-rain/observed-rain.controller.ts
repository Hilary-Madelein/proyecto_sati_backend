import { BadRequestException, Controller, Get, Param, ParseFloatPipe, ParseIntPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OBSERVED_HOURS, ObservedRainService, type ObservedHours } from './observed-rain.service.js';

function toHours(value: number): ObservedHours {
  if (!OBSERVED_HOURS.includes(value as ObservedHours)) {
    throw new BadRequestException(`Las horas deben ser ${OBSERVED_HOURS.join(', ')}`);
  }
  return value as ObservedHours;
}

@ApiTags('Lluvia observada')
@Controller('observed-rain')
export class ObservedRainController {
  constructor(private readonly rain: ObservedRainService) {}

  @Get()
  @ApiOperation({ summary: 'Productos satelitales: última hora con datos y ventanas 24/48/72 h disponibles' })
  availability() {
    return this.rain.availability();
  }

  @Get(':product/accumulated/:hours')
  @ApiOperation({ summary: 'Lluvia observada acumulada hasta la última hora: ventana, límites y ruta de la imagen' })
  accumulated(@Param('product') product: string, @Param('hours', ParseIntPipe) hours: number) {
    return this.rain.accumulated(product, toHours(hours));
  }

  @Get(':product/accumulated/:hours/value')
  @ApiOperation({ summary: 'Lluvia observada acumulada en un punto (mm); mm es null fuera del Ecuador o sin dato' })
  value(
    @Param('product') product: string,
    @Param('hours', ParseIntPipe) hours: number,
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
  ) {
    return this.rain.valueAt(product, toHours(hours), lat, lng);
  }

  @Get(':product/accumulated/:hours/image')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'Imagen PNG de la lluvia observada acumulada, lista para superponer en el mapa' })
  async image(
    @Param('product') product: string,
    @Param('hours', ParseIntPipe) hours: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const png = await this.rain.image(product, toHours(hours));
    // La URL lleva la última hora (`to`): cambia sola cuando llega un dato nuevo.
    response.setHeader('Cache-Control', 'public, max-age=3600');
    return new StreamableFile(png, { type: 'image/png' });
  }
}
