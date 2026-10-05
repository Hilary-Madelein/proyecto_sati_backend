import { Global, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { EventStore } from '../../modules/events/event-store.js';
import { SourceLock } from '../../modules/ingestion/source-lock.js';
import { SyncRunStore } from '../../modules/ingestion/sync-run-store.js';
import { STORAGE_MODE } from '../storage-mode.js';
import { InMemoryEventStore } from './in-memory-event.store.js';
import { InMemorySourceLock } from './in-memory-source.lock.js';
import { InMemorySyncRunStore } from './in-memory-sync-run.store.js';
import { JsonFilePersistence } from './json-file-persistence.js';

/**
 * Almacenamiento en memoria (STORAGE=memory): sin base de datos. Con
 * MEMORY_PERSIST_DIR los datos se guardan en archivos y sobreviven a reinicios.
 */
@Global()
@Module({
  providers: [
    JsonFilePersistence,
    { provide: STORAGE_MODE, useValue: 'memory' },
    { provide: EventStore, useClass: InMemoryEventStore },
    { provide: SyncRunStore, useClass: InMemorySyncRunStore },
    { provide: SourceLock, useClass: InMemorySourceLock },
  ],
  exports: [STORAGE_MODE, EventStore, SyncRunStore, SourceLock],
})
export class MemoryStorageModule implements OnModuleInit {
  onModuleInit(): void {
    new Logger('Storage').warn('Almacenamiento en memoria con copia en archivos (STORAGE=postgres para usar la BD)');
  }
}
