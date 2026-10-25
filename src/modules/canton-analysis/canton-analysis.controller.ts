import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CantonAnalysisService } from './canton-analysis.service.js';

@ApiTags('Análisis por cantón')
@Controller('canton-analysis')
export class CantonAnalysisController {
  constructor(private readonly analysis: CantonAnalysisService) {}

  @Get()
  @ApiOperation({
    summary: 'Semáforo por cantón con la lluvia de 12 h y lo que hay en cada uno',
    description:
      'Lluvia del pluviómetro del INAMHI si el cantón tiene uno con datos; si no, la del satélite. Por cantón: ' +
      'factores detonantes, elementos expuestos, acciones preventivas y herramientas para la respuesta. Se recalcula cada hora.',
  })
  snapshot() {
    return this.analysis.snapshot();
  }
}
