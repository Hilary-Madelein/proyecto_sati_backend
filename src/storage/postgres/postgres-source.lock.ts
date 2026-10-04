import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SourceLock } from '../../modules/ingestion/source-lock.js';

/**
 * Bloqueo con `pg_try_advisory_lock`: vale entre varias instancias del backend
 * que comparten la misma base de datos. El bloqueo es de sesión, por eso se
 * toma y se libera con la misma conexión.
 */
@Injectable()
export class PostgresSourceLock extends SourceLock {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      const [{ locked }] = await queryRunner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key]);
      if (!locked) return null;
      try {
        return await task();
      } finally {
        await queryRunner.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      }
    } finally {
      await queryRunner.release();
    }
  }
}
