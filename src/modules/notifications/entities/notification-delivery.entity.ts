import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const DELIVERY_STATUSES = ['sent', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * Historial de envíos: un registro por alerta, canal y destinatario. Sirve para
 * auditar qué se envió y para no repetir el mismo aviso (p. ej. tras un reinicio).
 */
@Entity({ name: 'notification_deliveries' })
@Index('ix_notification_deliveries_alert', ['alertKey', 'channel', 'recipient'])
@Index('ix_notification_deliveries_created_at', ['createdAt'])
export class NotificationDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Identifica el aviso: evento + motivo + severidad (ver `HazardAlert.key`). */
  @Column({ name: 'alert_key', type: 'varchar', length: 160 })
  alertKey: string;

  /** Evento que originó el aviso, si lo hay (las pruebas de envío no tienen). */
  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId: string | null;

  /** Suscriptor, si aún existe (al borrarlo, el historial se conserva). */
  @Column({ name: 'subscriber_id', type: 'uuid', nullable: true })
  subscriberId: string | null;

  /** Dirección a la que se envió (se guarda aunque el suscriptor cambie o se borre). */
  @Column({ type: 'varchar', length: 254 })
  recipient: string;

  @Column({ type: 'varchar', length: 32 })
  channel: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'varchar', length: 16 })
  status: DeliveryStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
