import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { SyncRunEntity } from '../../modules/ingestion/entities/sync-run.entity.js';
import { SyncRunStore } from '../../modules/ingestion/sync-run-store.js';

/** Solo se conservan las últimas ejecuciones, para no crecer sin límite. */
const MAX_RUNS = 500;

@Injectable()
export class InMemorySyncRunStore extends SyncRunStore {
  /** De la más reciente a la más antigua. */
  private runs: SyncRunEntity[] = [];

  async save(run: SyncRunEntity): Promise<SyncRunEntity> {
    if (!run.id) {
      run.id = randomUUID();
      this.runs = [run, ...this.runs].slice(0, MAX_RUNS);
    }
    return run;
  }

  async findLatest(source: string): Promise<SyncRunEntity | null> {
    return this.runs.find((run) => run.source === source) ?? null;
  }

  async findLatestSuccess(source: string): Promise<SyncRunEntity | null> {
    const successes = this.runs.filter((run) => run.source === source && run.status === 'success');
    return successes.sort((a, b) => b.windowTo.getTime() - a.windowTo.getTime())[0] ?? null;
  }

  async list(source: string | undefined, limit: number): Promise<SyncRunEntity[]> {
    return this.runs.filter((run) => !source || run.source === source).slice(0, limit);
  }
}
