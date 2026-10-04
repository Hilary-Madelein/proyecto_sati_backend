import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type SyncRunStatus = 'running' | 'success' | 'failed';
export type SyncTrigger = 'startup' | 'schedule' | 'manual';

/** Bitácora de cada sincronización: sirve para monitorear las fuentes y calcular la siguiente ventana. */
@Entity({ name: 'sync_runs' })
@Index('ix_sync_runs_source_started_at', ['source', 'startedAt'])
export class SyncRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  source: string;

  @Column({ type: 'varchar', length: 16 })
  status: SyncRunStatus;

  @Column({ type: 'varchar', length: 16 })
  trigger: SyncTrigger;

  @Column({ name: 'window_from', type: 'timestamptz' })
  windowFrom: Date;

  @Column({ name: 'window_to', type: 'timestamptz' })
  windowTo: Date;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  fetched: number;

  @Column({ type: 'integer', default: 0 })
  created: number;

  @Column({ type: 'integer', default: 0 })
  updated: number;

  @Column({ type: 'integer', default: 0 })
  unchanged: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
