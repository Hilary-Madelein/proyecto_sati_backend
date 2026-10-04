import type { DataSourceOptions } from 'typeorm';
import { HazardEventEntity } from '../modules/events/entities/hazard-event.entity.js';
import { SyncRunEntity } from '../modules/ingestion/entities/sync-run.entity.js';
import { InitialSchema1790985600000 } from './migrations/1790985600000-initial-schema.js';

/**
 * Entidades y migraciones se listan explícitamente (sin patrones de archivos):
 * funciona igual con ESM, en desarrollo y en el build.
 */
export const ENTITIES = [HazardEventEntity, SyncRunEntity];
export const MIGRATIONS = [InitialSchema1790985600000];

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
