import { ConditionalModule } from '@nestjs/config';
import { MemoryStorageModule } from './memory/memory-storage.module.js';
import { PostgresStorageModule } from './postgres/postgres-storage.module.js';

const usesPostgres = (env: NodeJS.ProcessEnv) => env.STORAGE === 'postgres';

/**
 * Elige el almacenamiento según STORAGE (por defecto, memoria). Solo se carga
 * uno de los dos módulos: en modo memoria ni siquiera se intenta conectar a la BD.
 */
export const StorageModule = {
  forRoot: () => [
    ConditionalModule.registerWhen(PostgresStorageModule, usesPostgres),
    ConditionalModule.registerWhen(MemoryStorageModule, (env) => !usesPostgres(env)),
  ],
};
