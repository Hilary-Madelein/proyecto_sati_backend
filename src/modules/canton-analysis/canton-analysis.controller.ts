import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CantonAnalysisService } from './canton-analysis.service.js';

@ApiTags('Análisis por cantón')
@Controller('canton-analysis')
export class CantonAnalysisController {
  constructor(private readonly analysis: CantonAnalysisService) {}

  @Get()
  @ApiOperation({
    summary: 'Semáforo por cantón con la lluvia pronosticada de 12 y 24 h y lo que hay en cada uno',
    description:
      'Pronóstico WRF del INAMHI en cada cantón (percentil 90 de sus celdas) para las próximas 12 y 24 h, con los ' +
      'umbrales del documento de la SNGR: manda el color más alto de las dos ventanas. Por ' +
      'cantón: factores detonantes, elementos expuestos, acciones preventivas y herramientas para la respuesta. Se recalcula cada hora.',
  })
  snapshot() {
    return this.analysis.snapshot();
  }
}
