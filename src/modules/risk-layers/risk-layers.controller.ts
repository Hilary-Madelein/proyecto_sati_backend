import { Controller, Get, Param } from '@nestjs/common';
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
}
