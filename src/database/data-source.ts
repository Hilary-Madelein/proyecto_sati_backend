/**
 * DataSource para la CLI de TypeORM (migraciones). Se usa sobre el build:
 *   npm run migration:run
 * La aplicación no lo usa: se conecta con DatabaseModule.
 */
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.options.js';

try {
  process.loadEnvFile();
} catch {
  // Sin archivo .env: se usan las variables del entorno.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Falta DATABASE_URL');

export default new DataSource(buildDataSourceOptions(databaseUrl, process.env.DATABASE_SSL === 'true'));
