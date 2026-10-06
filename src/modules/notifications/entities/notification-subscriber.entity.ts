import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Severity } from '../../events/domain/severity.js';

/** Severidades que pueden elegirse como mínimo para recibir alertas (las que generan alertas). */
export const SUBSCRIBER_MIN_SEVERITIES = ['critical', 'high'] as const satisfies readonly Severity[];
export type SubscriberMinSeverity = (typeof SUBSCRIBER_MIN_SEVERITIES)[number];

/**
 * Persona que recibe alertas por correo. Elige de qué provincias (vacío =
 * todo el país) y desde qué severidad. La registra un administrador.
 */
@Entity({ name: 'notification_subscribers' })
export class NotificationSubscriberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** En minúsculas; único. */
  @Column({ type: 'varchar', length: 254, unique: true })
  email: string;

  /** Nombres oficiales de provincia (ver ECUADOR_PROVINCES). Vacío = todas. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  provinces: string[];

  /** Recibe alertas de esta severidad o más graves. */
  @Column({ name: 'min_severity', type: 'varchar', length: 16, default: 'high' })
  minSeverity: SubscriberMinSeverity;

  /** Desactivado = se conserva, pero no recibe nada. */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
