import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { STORAGE_MODE, type StorageMode } from '../../storage/storage-mode.js';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
    @Inject(STORAGE_MODE) private readonly storage: StorageMode,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Estado del servicio y, si se usa, de la base de datos' })
  check() {
    if (this.storage === 'memory') return this.health.check([]);
    return this.health.check([() => this.database.pingCheck('database', { timeout: 3_000 })]);
  }
}
