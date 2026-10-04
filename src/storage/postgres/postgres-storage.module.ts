import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../../config/app-config.service.js';
import { buildDataSourceOptions } from '../../database/database.options.js';
import { HazardEventEntity } from '../../modules/events/entities/hazard-event.entity.js';
import { EventStore } from '../../modules/events/event-store.js';
import { SyncRunEntity } from '../../modules/ingestion/entities/sync-run.entity.js';
import { SourceLock } from '../../modules/ingestion/source-lock.js';
import { SyncRunStore } from '../../modules/ingestion/sync-run-store.js';
import { STORAGE_MODE } from '../storage-mode.js';
import { PostgresSourceLock } from './postgres-source.lock.js';
import { TypeOrmEventStore } from './typeorm-event.store.js';
import { TypeOrmSyncRunStore } from './typeorm-sync-run.store.js';

/** Almacenamiento en PostgreSQL + PostGIS (STORAGE=postgres). */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        ...buildDataSourceOptions(config.get('DATABASE_URL')!, config.get('DATABASE_SSL')),
        // Aplica las migraciones pendientes al arrancar: el esquema siempre coincide con el código.
        migrationsRun: true,
      }),
    }),
    TypeOrmModule.forFeature([HazardEventEntity, SyncRunEntity]),
  ],
  providers: [
    { provide: STORAGE_MODE, useValue: 'postgres' },
    { provide: EventStore, useClass: TypeOrmEventStore },
    { provide: SyncRunStore, useClass: TypeOrmSyncRunStore },
    { provide: SourceLock, useClass: PostgresSourceLock },
  ],
  exports: [STORAGE_MODE, EventStore, SyncRunStore, SourceLock],
})
export class PostgresStorageModule {}
