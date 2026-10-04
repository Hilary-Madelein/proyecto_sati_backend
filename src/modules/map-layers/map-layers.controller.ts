import { Controller, Get, HttpStatus, Param, ParseIntPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MapLayersService } from './map-layers.service.js';

@ApiTags('Capas de mapa')
@Controller('layers')
export class MapLayersController {
  constructor(private readonly layers: MapLayersService) {}

  @Get()
  @ApiOperation({ summary: 'Capas de mapa disponibles' })
  list() {
    // Sin URLs ni nombres internos del servidor de origen.
    return this.layers.list().map((layer) => {
      const { id, kind, title, description, category, attribution } = layer;
      const extra =
        layer.kind === 'wms'
          ? { unit: layer.unit, extraParams: layer.extraParams }
          : { sourceLayer: layer.sourceLayer, minZoom: layer.minZoom, maxZoom: layer.maxZoom };
      return { id, kind, title, description, category, attribution, ...extra };
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Pasos de tiempo disponibles, corrida del modelo y si el pronóstico está atrasado' })
  availability(@Param('id') id: string) {
    return this.layers.availability(id);
  }

  @Get(':id/legend')
  @ApiOperation({ summary: 'Rampa de colores real de la capa' })
  legend(@Param('id') id: string) {
    return this.layers.legend(id);
  }

  @Get(':id/wms')
  @ApiProduces('image/png', 'application/json')
  @ApiOperation({
    summary: 'Proxy WMS de la capa (GetMap, GetFeatureInfo, GetLegendGraphic)',
    description: 'Úsalo como URL de una capa WMS en Leaflet. La capa la fija el servidor; LAYERS se ignora.',
  })
  async wms(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { body, contentType, cacheSeconds } = await this.layers.proxy(id, query);
    response.setHeader('Cache-Control', `public, max-age=${cacheSeconds}`);
    return new StreamableFile(body, { type: contentType });
  }

  @Get(':id/tiles/:z/:x/:y')
  @ApiProduces('application/x-protobuf')
  @ApiOperation({ summary: 'Proxy de teselas vectoriales (MVT) de la capa' })
  async tile(
    @Param('id') id: string,
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | void> {
    const tile = await this.layers.vectorTile(id, z, x, y);
    if (!tile) {
      response.status(HttpStatus.NO_CONTENT);
      return;
    }
    response.setHeader('Cache-Control', `public, max-age=${tile.cacheSeconds}`);
    return new StreamableFile(tile.body, { type: 'application/x-protobuf' });
  }
}
