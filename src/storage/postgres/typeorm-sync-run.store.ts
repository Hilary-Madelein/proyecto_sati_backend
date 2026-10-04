import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncRunEntity } from '../../modules/ingestion/entities/sync-run.entity.js';
import { SyncRunStore } from '../../modules/ingestion/sync-run-store.js';

@Injectable()
export class TypeOrmSyncRunStore extends SyncRunStore {
  constructor(@InjectRepository(SyncRunEntity) private readonly repository: Repository<SyncRunEntity>) {
    super();
  }

  save(run: SyncRunEntity): Promise<SyncRunEntity> {
    return this.repository.save(run);
  }

  findLatest(source: string): Promise<SyncRunEntity | null> {
    return this.repository.findOne({ where: { source }, order: { startedAt: 'DESC' } });
  }

  findLatestSuccess(source: string): Promise<SyncRunEntity | null> {
    return this.repository.findOne({ where: { source, status: 'success' }, order: { windowTo: 'DESC' } });
  }

  list(source: string | undefined, limit: number): Promise<SyncRunEntity[]> {
    return this.repository.find({ where: source ? { source } : {}, order: { startedAt: 'DESC' }, take: limit });
  }
}
