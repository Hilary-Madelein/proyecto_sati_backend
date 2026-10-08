import type { DeliveryStatus, NotificationDeliveryEntity } from './entities/notification-delivery.entity.js';
import type { NotificationSubscriberEntity } from './entities/notification-subscriber.entity.js';

/**
 * Contratos de almacenamiento de notificaciones. Como los de eventos, tienen
 * una implementación en memoria y otra en PostgreSQL (ver `src/storage/`).
 */
export abstract class SubscriberStore {
  /** Todos, del más reciente al más antiguo. */
  abstract list(): Promise<NotificationSubscriberEntity[]>;
  abstract listActive(): Promise<NotificationSubscriberEntity[]>;
  abstract findById(id: string): Promise<NotificationSubscriberEntity | null>;
  /** `email` ya en minúsculas. */
  abstract findByEmail(email: string): Promise<NotificationSubscriberEntity | null>;
  /** Crea (sin id) o actualiza; devuelve la entidad con id y fechas. */
  abstract save(subscriber: NotificationSubscriberEntity): Promise<NotificationSubscriberEntity>;
  /** true si existía. */
  abstract delete(id: string): Promise<boolean>;
}

export abstract class DeliveryStore {
  /** ¿Ya se envió con éxito este aviso por este canal a esta dirección? */
  abstract wasSent(alertKey: string, channel: string, recipient: string): Promise<boolean>;
  abstract record(delivery: NotificationDeliveryEntity): Promise<void>;
  /** Del más reciente al más antiguo; `status` filtra por resultado. */
  abstract list(page: { limit: number; offset: number; status?: DeliveryStatus }): Promise<{
    items: NotificationDeliveryEntity[];
    total: number;
  }>;
  /** Envíos registrados desde `since`, por resultado. */
  abstract countSince(since: Date): Promise<Record<DeliveryStatus, number>>;
}
