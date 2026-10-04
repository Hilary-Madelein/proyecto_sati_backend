import { Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ADMIN_TOKEN_HEADER, AdminTokenGuard } from '../../common/auth/admin-token.guard.js';
import { IngestionService } from './ingestion.service.js';

@ApiTags('Ingesta')
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Get('sources')
  @ApiOperation({ summary: 'Fuentes de eventos registradas y su última sincronización' })
  listSources() {
    return this.ingestion.listSources();
  }

  @Get('runs')
  @ApiOperation({ summary: 'Historial de sincronizaciones' })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'limit', required: false, schema: { default: 20, maximum: 100 } })
  listRuns(
    @Query('source') source: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.ingestion.listRuns(source, Math.min(Math.max(limit, 1), 100));
  }

  @Post('sources/:key/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AdminTokenGuard)
  @ApiSecurity(ADMIN_TOKEN_HEADER)
  @ApiOperation({ summary: 'Lanza una sincronización manual (en segundo plano)' })
  @ApiAcceptedResponse({ description: 'Sincronización iniciada; ver GET /ingestion/runs' })
  run(@Param('key') key: string) {
    this.ingestion.trigger(key);
    return { status: 'started', source: key };
  }
}
