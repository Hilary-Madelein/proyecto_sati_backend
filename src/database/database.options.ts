import type { DataSourceOptions } from 'typeorm';
import { AdminSessionEntity } from '../modules/admin-auth/entities/admin-session.entity.js';
import { AdminUserEntity } from '../modules/admin-auth/entities/admin-user.entity.js';
import { HazardEventEntity } from '../modules/events/entities/hazard-event.entity.js';
import { SyncRunEntity } from '../modules/ingestion/entities/sync-run.entity.js';
import { NotificationDeliveryEntity } from '../modules/notifications/entities/notification-delivery.entity.js';
import { NotificationSubscriberEntity } from '../modules/notifications/entities/notification-subscriber.entity.js';
import { InitialSchema1790985600000 } from './migrations/1790985600000-initial-schema.js';
import { Notifications1791244800000 } from './migrations/1791244800000-notifications.js';
import { AdminAccounts1791331200000 } from './migrations/1791331200000-admin-accounts.js';

/**
 * Entidades y migraciones se listan explícitamente (sin patrones de archivos):
 * funciona igual con ESM, en desarrollo y en el build.
 */
export const ENTITIES = [
  HazardEventEntity,
  SyncRunEntity,
  NotificationSubscriberEntity,
  NotificationDeliveryEntity,
  AdminUserEntity,
  AdminSessionEntity,
];
export const MIGRATIONS = [InitialSchema1790985600000, Notifications1791244800000, AdminAccounts1791331200000];

export function buildDataSourceOptions(databaseUrl: string, ssl: boolean): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    uuidExtension: 'pgcrypto',
    entities: ENTITIES,
    migrations: MIGRATIONS,
    // El esquema solo cambia con migraciones, nunca automáticamente.
    synchronize: false,
  };
}
