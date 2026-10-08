import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import {
  NotificationDeliveryEntity,
  type DeliveryStatus,
} from '../../modules/notifications/entities/notification-delivery.entity.js';
import { NotificationSubscriberEntity } from '../../modules/notifications/entities/notification-subscriber.entity.js';
import { DeliveryStore, SubscriberStore } from '../../modules/notifications/notification-stores.js';
import { JsonFilePersistence } from './json-file-persistence.js';

const SUBSCRIBERS = 'notification-subscribers';
const DELIVERIES = 'notification-deliveries';
/** El historial en memoria guarda solo los últimos envíos. */
const MAX_DELIVERIES = 2_000;

type Stored<T> = Omit<T, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt?: string };

@Injectable()
export class InMemorySubscriberStore extends SubscriberStore {
  private readonly subscribers = new Map<string, NotificationSubscriberEntity>();

  constructor(@Optional() private readonly persistence?: JsonFilePersistence) {
    super();
    for (const stored of persistence?.load<Stored<NotificationSubscriberEntity>[]>(SUBSCRIBERS) ?? []) {
      this.subscribers.set(
        stored.id,
        Object.assign(new NotificationSubscriberEntity(), stored, {
          createdAt: new Date(stored.createdAt),
          updatedAt: new Date(stored.updatedAt ?? stored.createdAt),
        }),
      );
    }
  }

  async list(): Promise<NotificationSubscriberEntity[]> {
    return [...this.subscribers.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listActive(): Promise<NotificationSubscriberEntity[]> {
    return [...this.subscribers.values()].filter((subscriber) => subscriber.active);
  }

  async findById(id: string): Promise<NotificationSubscriberEntity | null> {
    return this.subscribers.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<NotificationSubscriberEntity | null> {
    return [...this.subscribers.values()].find((subscriber) => subscriber.email === email) ?? null;
  }

  async save(subscriber: NotificationSubscriberEntity): Promise<NotificationSubscriberEntity> {
    const now = new Date();
    if (!subscriber.id) Object.assign(subscriber, { id: randomUUID(), createdAt: now });
    subscriber.updatedAt = now;
    this.subscribers.set(subscriber.id, subscriber);
    this.persist();
    return subscriber;
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.subscribers.delete(id);
    if (existed) this.persist();
    return existed;
  }

  private persist(): void {
    this.persistence?.save(SUBSCRIBERS, () => [...this.subscribers.values()]);
  }
}

@Injectable()
export class InMemoryDeliveryStore extends DeliveryStore {
  /** Del más reciente al más antiguo. */
  private deliveries: NotificationDeliveryEntity[] = [];

  constructor(@Optional() private readonly persistence?: JsonFilePersistence) {
    super();
    this.deliveries = (persistence?.load<Stored<NotificationDeliveryEntity>[]>(DELIVERIES) ?? []).map((stored) =>
      Object.assign(new NotificationDeliveryEntity(), stored, { createdAt: new Date(stored.createdAt) }),
    );
  }

  async wasSent(alertKey: string, channel: string, recipient: string): Promise<boolean> {
    return this.deliveries.some(
      (delivery) =>
        delivery.alertKey === alertKey && delivery.channel === channel && delivery.recipient === recipient && delivery.status === 'sent',
    );
  }

  async record(delivery: NotificationDeliveryEntity): Promise<void> {
    Object.assign(delivery, { id: randomUUID(), createdAt: new Date() });
    this.deliveries = [delivery, ...this.deliveries].slice(0, MAX_DELIVERIES);
    this.persistence?.save(DELIVERIES, () => this.deliveries);
  }

  async list(page: { limit: number; offset: number; status?: DeliveryStatus }) {
    const matching = page.status ? this.deliveries.filter((delivery) => delivery.status === page.status) : this.deliveries;
    return { items: matching.slice(page.offset, page.offset + page.limit), total: matching.length };
  }

  async countSince(since: Date): Promise<Record<DeliveryStatus, number>> {
    const counts: Record<DeliveryStatus, number> = { sent: 0, failed: 0 };
    for (const delivery of this.deliveries) {
      if (delivery.createdAt < since) break;
      counts[delivery.status]++;
    }
    return counts;
  }
}
