import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FloodHubService } from './flood-hub.service.js';

@ApiTags('Google Flood Hub')
@Controller('flood-hub')
export class FloodHubController {
  constructor(private readonly floodHub: FloodHubService) {}

  @Get()
  @ApiOperation({ summary: 'Crecidas repentinas urbanas del Ecuador pronosticadas por Google (probable y muy probable)' })
  async snapshot() {
    // Los puntos de los ríos solo alimentan el análisis por parroquia: el mapa muestra polígonos.
    const { gauges: _gauges, ...snapshot } = await this.floodHub.snapshot();
    return snapshot;
  }
}
