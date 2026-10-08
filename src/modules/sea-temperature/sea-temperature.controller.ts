import { Controller, Get, ParseFloatPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SeaTemperatureService } from './sea-temperature.service.js';

@ApiTags('Temperatura del mar')
@Controller('sea-temperature')
export class SeaTemperatureController {
  constructor(private readonly sea: SeaTemperatureService) {}

  @Get()
  @ApiOperation({ summary: 'Anomalía de la temperatura del mar: día del dato, anomalía de Niño 1+2, límites, leyenda y ruta de la imagen' })
  current() {
    return this.sea.current();
  }

  @Get('value')
  @ApiOperation({ summary: 'Temperatura (°C) y anomalía (°C) del mar en un punto; null en tierra' })
  value(@Query('lat', ParseFloatPipe) lat: number, @Query('lng', ParseFloatPipe) lng: number) {
    return this.sea.valueAt(lat, lng);
  }

  @Get('image')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'Imagen PNG de la anomalía, lista para superponer en el mapa' })
  async image(@Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const png = await this.sea.image();
    // La URL lleva el día del dato (`time`): cambia sola cuando llega uno nuevo.
    response.setHeader('Cache-Control', 'public, max-age=3600');
    return new StreamableFile(png, { type: 'image/png' });
  }
}
