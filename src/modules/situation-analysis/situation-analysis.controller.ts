import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SituationAnalysisService } from './situation-analysis.service.js';

@ApiTags('Análisis de la situación')
@Controller('situation-analysis')
export class SituationAnalysisController {
  constructor(private readonly situation: SituationAnalysisService) {}

  @Get()
  @ApiOperation({
    summary: 'Análisis de la situación del momento, redactado con IA (Gemini) a partir de los datos del sistema',
    description:
      'Del país, de una provincia o de varias juntas. Junta el pronóstico de lluvia por parroquia, la lluvia medida en estaciones, las crecidas ' +
      'repentinas de Google, los tramos de río en alerta y las inundaciones de la SNGR, y lo redacta en cuatro partes. La IA no ' +
      'decide niveles ni cifras; si no responde, sale un resumen de plantilla (`writer: "template"`). Se guarda 15 minutos por lugar.',
  })
  @ApiQuery({ name: 'province', required: false, description: 'Nombre de la provincia, con o sin tildes; varias, separadas por comas ("Manabí,Loja"). Vacío = todo el país.' })
  analyze(@Query('province') province?: string) {
    return this.situation.forProvince(province);
  }

  @Get('question')
  @ApiOperation({
    summary: 'Responde una pregunta sobre el análisis de un lugar, con los mismos datos',
    description:
      'La IA responde solo con los datos del momento del lugar; si el dato no está, lo dice. El visor permite dos preguntas por análisis. ' +
      'Responde 503 si la IA no está disponible o su respuesta no pasa el control de cifras.',
  })
  @ApiQuery({ name: 'province', required: false, description: 'Nombre de la provincia, con o sin tildes; varias, separadas por comas ("Manabí,Loja"). Vacío = todo el país.' })
  @ApiQuery({ name: 'question', description: 'La pregunta, de hasta 300 caracteres.' })
  ask(@Query('province') province?: string, @Query('question') question?: string) {
    return this.situation.ask(province, question);
  }
}
