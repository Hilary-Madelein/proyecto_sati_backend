import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskLayersService } from './risk-layers.service.js';

@ApiTags('Gestión del riesgo')
@Controller('risk-layers')
export class RiskLayersController {
  constructor(private readonly layers: RiskLayersService) {}

  @Get()
  @ApiOperation({ summary: 'Capas de amenaza, exposición, preparación y respuesta' })
  list() {
    return this.layers.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Entidades de la capa (GeoJSON en WGS84) con su fuente y fecha de descarga' })
  get(@Param('id') id: string) {
    return this.layers.get(id);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'Fotos de todas las entidades de la capa, por id de entidad (solo las que tienen)' })
  layerAttachments(@Param('id') id: string) {
    return this.layers.layerAttachments(id);
  }

  @Get(':id/features/:objectId/attachments')
  @ApiOperation({ summary: 'Fotos de una entidad (solo imágenes), servidas desde el servicio de origen' })
  attachments(@Param('id') id: string, @Param('objectId', ParseIntPipe) objectId: number) {
    return this.layers.attachments(id, objectId);
  }
}
