import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { SyncRunEntity } from '../../modules/ingestion/entities/sync-run.entity.js';
import { SyncRunStore } from '../../modules/ingestion/sync-run-store.js';
import { JsonFilePersistence } from './json-file-persistence.js';

const SNAPSHOT = 'sync-runs';
type StoredRun = Omit<SyncRunEntity, 'windowFrom' | 'windowTo' | 'startedAt' | 'finishedAt'> & {
  windowFrom: string;
  windowTo: string;
  startedAt: string;
  finishedAt: string | null;
};

/** Solo se conservan las últimas ejecuciones, para no crecer sin límite. */
const MAX_RUNS = 500;

@Injectable()
export class InMemorySyncRunStore extends SyncRunStore {
  /** De la más reciente a la más antigua. */
  private runs: SyncRunEntity[] = [];

  constructor(@Optional() private readonly persistence?: JsonFilePersistence) {
    super();
    this.runs = (persistence?.load<StoredRun[]>(SNAPSHOT) ?? []).map((stored) =>
      Object.assign(new SyncRunEntity(), stored, {
        windowFrom: new Date(stored.windowFrom),
        windowTo: new Date(stored.windowTo),
        startedAt: new Date(stored.startedAt),
        finishedAt: stored.finishedAt ? new Date(stored.finishedAt) : null,
        // Una sincronización que quedó a medias por un reinicio no terminó bien.
        ...(stored.status === 'running' && { status: 'failed', error: 'interrumpida por un reinicio' }),
      }),
    );
  }

  async save(run: SyncRunEntity): Promise<SyncRunEntity> {
    if (!run.id) {
      run.id = randomUUID();
      this.runs = [run, ...this.runs].slice(0, MAX_RUNS);
    }
    this.persistence?.save(SNAPSHOT, () => this.runs);
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
