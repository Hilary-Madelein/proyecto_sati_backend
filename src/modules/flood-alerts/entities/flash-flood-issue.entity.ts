import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { FlashFloodArea } from '../../flood-hub/flood-hub-source.js';
import type { WatchedCanton } from '../flash-flood-transitions.js';

/**
 * Una emisión de crecidas repentinas de Google. Google no entrega pronósticos
 * pasados: este archivo permite medir después cuántos se cumplieron frente a la
 * SNGR y con cuánta anticipación. La última fila guarda además los avisos vigentes.
 */
@Entity({ name: 'flash_flood_issues' })
export class FlashFloodIssueEntity {
  @PrimaryColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil: Date;

  /** Zonas tal como las entregó Google. */
  @Column({ type: 'jsonb' })
  zones: FlashFloodArea[];

  /** Avisos vigentes tras procesar esta emisión. */
  @Column({ type: 'jsonb' })
  cantons: WatchedCanton[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
