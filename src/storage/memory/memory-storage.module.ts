import { Global, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { AdminSessionStore, AdminUserStore } from '../../modules/admin-auth/admin-auth-stores.js';
import { EventStore } from '../../modules/events/event-store.js';
import { SourceLock } from '../../modules/ingestion/source-lock.js';
import { SyncRunStore } from '../../modules/ingestion/sync-run-store.js';
import { DeliveryStore, SubscriberStore } from '../../modules/notifications/notification-stores.js';
import { STORAGE_MODE } from '../storage-mode.js';
import { InMemoryAdminSessionStore, InMemoryAdminUserStore } from './in-memory-admin-auth.stores.js';
import { InMemoryEventStore } from './in-memory-event.store.js';
import { InMemoryDeliveryStore, InMemorySubscriberStore } from './in-memory-notification.stores.js';
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
    { provide: SubscriberStore, useClass: InMemorySubscriberStore },
    { provide: DeliveryStore, useClass: InMemoryDeliveryStore },
    // Al borrar una cuenta, su almacén cierra sus sesiones: comparten instancia.
    InMemoryAdminSessionStore,
    { provide: AdminSessionStore, useExisting: InMemoryAdminSessionStore },
    { provide: AdminUserStore, useClass: InMemoryAdminUserStore },
  ],
  exports: [STORAGE_MODE, EventStore, SyncRunStore, SourceLock, SubscriberStore, DeliveryStore, AdminUserStore, AdminSessionStore],
})
export class MemoryStorageModule implements OnModuleInit {
  onModuleInit(): void {
    new Logger('Storage').warn('Almacenamiento en memoria con copia en archivos (STORAGE=postgres para usar la BD)');
  }
}
