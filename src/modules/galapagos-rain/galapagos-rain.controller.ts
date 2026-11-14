import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GalapagosRainService } from './galapagos-rain.service.js';

@ApiTags('Galápagos')
@Controller('galapagos-rain')
export class GalapagosRainController {
  constructor(private readonly rain: GalapagosRainService) {}

  @Get()
  @ApiOperation({ summary: 'Lluvia de las dos estaciones de Galápagos con sus propios umbrales de alarma y los dos episodios de referencia' })
  snapshot() {
    return this.rain.snapshot();
  }
}
