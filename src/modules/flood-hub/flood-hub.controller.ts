import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FloodHubService } from './flood-hub.service.js';

@ApiTags('Google Flood Hub')
@Controller('flood-hub')
export class FloodHubController {
  constructor(private readonly floodHub: FloodHubService) {}

  @Get()
  @ApiOperation({ summary: 'Último pronóstico de Flood Hub en cada punto del Ecuador (nivel, tendencia y ventana)' })
  snapshot() {
    return this.floodHub.snapshot();
  }
}
