import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  type Point,
} from 'typeorm';
import type { HazardType } from '../domain/hazard-type.js';
import type { EventStatus } from '../domain/normalized-event.js';
import type { Severity } from '../domain/severity.js';

@Entity({ name: 'hazard_events' })
@Unique('uq_hazard_events_source_external_id', ['source', 'externalId'])
export class HazardEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  source: string;

  @Column({ name: 'external_id', type: 'varchar', length: 64 })
  externalId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  code: string | null;

  @Index('ix_hazard_events_hazard_type')
  @Column({ name: 'hazard_type', type: 'varchar', length: 32 })
  hazardType: HazardType;

  @Index('ix_hazard_events_severity')
  @Column({ type: 'varchar', length: 16 })
  severity: Severity;

  /** Nivel oficial de la fuente (p. ej. SNGR: 1, 2, 3…). */
  @Column({ type: 'smallint', nullable: true })
  level: number | null;

  @Column({ type: 'varchar', length: 16 })
  status: EventStatus;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index('ix_hazard_events_province')
  @Column({ type: 'varchar', length: 120, nullable: true })
  province: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  canton: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sector: string | null;

  /** Punto WGS84 (PostGIS). Permite filtrar por zona o distancia. */
  @Index('ix_hazard_events_location', { spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location: Point;

  @Index('ix_hazard_events_occurred_at')
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'integer', default: 0 })
  affected: number;

  @Column({ name: 'houses_affected', type: 'integer', default: 0 })
  housesAffected: number;

  @Column({ type: 'integer', default: 0 })
  evacuated: number;

  @Column({ type: 'integer', default: 0 })
  deceased: number;

  /** Registro original de la fuente. */
  @Column({ type: 'jsonb' })
  raw: unknown;

  /** Hash del registro original: si cambia, el evento se actualizó en la fuente. */
  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash: string;

  /** Última vez que la fuente devolvió este evento. */
  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Última vez que cambió el contenido del evento (no cada vez que se vuelve a ver). */
  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
