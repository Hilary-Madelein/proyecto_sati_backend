import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import {
  NotificationDeliveryEntity,
  type DeliveryStatus,
} from '../../modules/notifications/entities/notification-delivery.entity.js';
import { NotificationSubscriberEntity } from '../../modules/notifications/entities/notification-subscriber.entity.js';
import { DeliveryStore, SubscriberStore } from '../../modules/notifications/notification-stores.js';

@Injectable()
export class TypeOrmSubscriberStore extends SubscriberStore {
  constructor(
    @InjectRepository(NotificationSubscriberEntity) private readonly repository: Repository<NotificationSubscriberEntity>,
  ) {
    super();
  }

  list(): Promise<NotificationSubscriberEntity[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  listActive(): Promise<NotificationSubscriberEntity[]> {
    return this.repository.find({ where: { active: true } });
  }

  findById(id: string): Promise<NotificationSubscriberEntity | null> {
    return this.repository.findOneBy({ id });
  }

  findByEmail(email: string): Promise<NotificationSubscriberEntity | null> {
    return this.repository.findOneBy({ email });
  }

  save(subscriber: NotificationSubscriberEntity): Promise<NotificationSubscriberEntity> {
    return this.repository.save(subscriber);
  }

  async delete(id: string): Promise<boolean> {
    return ((await this.repository.delete({ id })).affected ?? 0) > 0;
  }
}

@Injectable()
export class TypeOrmDeliveryStore extends DeliveryStore {
  constructor(
    @InjectRepository(NotificationDeliveryEntity) private readonly repository: Repository<NotificationDeliveryEntity>,
  ) {
    super();
  }

  wasSent(alertKey: string, channel: string, recipient: string): Promise<boolean> {
    return this.repository.existsBy({ alertKey, channel, recipient, status: 'sent' });
  }

  async record(delivery: NotificationDeliveryEntity): Promise<void> {
    await this.repository.insert(delivery);
  }

  async list(page: { limit: number; offset: number; status?: DeliveryStatus }) {
    const [items, total] = await this.repository.findAndCount({
      where: page.status ? { status: page.status } : {},
      order: { createdAt: 'DESC' },
      take: page.limit,
      skip: page.offset,
    });
    return { items, total };
  }

  async countSince(since: Date): Promise<Record<DeliveryStatus, number>> {
    const rows = await this.repository
      .createQueryBuilder('delivery')
      .select('delivery.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where({ createdAt: MoreThanOrEqual(since) })
      .groupBy('delivery.status')
      .getRawMany<{ status: DeliveryStatus; count: number }>();
    const counts: Record<DeliveryStatus, number> = { sent: 0, failed: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }
}
