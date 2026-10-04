import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EventsModule } from '../events/events.module.js';
import { IngestionController } from './ingestion.controller.js';
import { IngestionService } from './ingestion.service.js';

/** SyncRunStore y SourceLock los aporta el módulo de storage elegido con STORAGE. */
@Module({
  imports: [DiscoveryModule, EventsModule],
  controllers: [IngestionController],
  providers: [IngestionService],
})
export class IngestionModule {}
