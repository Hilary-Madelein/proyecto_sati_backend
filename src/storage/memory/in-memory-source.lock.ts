import { Injectable } from '@nestjs/common';
import { SourceLock } from '../../modules/ingestion/source-lock.js';

/** Bloqueo dentro del proceso: suficiente con una sola instancia del backend. */
@Injectable()
export class InMemorySourceLock extends SourceLock {
  private readonly held = new Set<string>();

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T | null> {
    if (this.held.has(key)) return null;
    this.held.add(key);
    try {
      return await task();
    } finally {
      this.held.delete(key);
    }
  }
}
