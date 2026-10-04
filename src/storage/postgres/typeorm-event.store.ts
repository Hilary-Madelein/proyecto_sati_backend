import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { HazardEventEntity } from '../../modules/events/entities/hazard-event.entity.js';
import { EventStore, type EventChanges, type EventFilters, type EventSummary } from '../../modules/events/event-store.js';

@Injectable()
export class TypeOrmEventStore extends EventStore {
  constructor(
    @InjectRepository(HazardEventEntity) private readonly repository: Repository<HazardEventEntity>,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  findExisting(source: string, externalIds: string[]): Promise<HazardEventEntity[]> {
    return this.repository.find({ where: { source, externalId: In(externalIds) } });
  }

  async save({ upserts, seenIds, seenAt }: EventChanges): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(HazardEventEntity);
      await repository.save(upserts, { chunk: 200 });
      if (seenIds.length > 0) await repository.update({ id: In(seenIds) }, { lastSeenAt: seenAt });
    });
  }

  async list(filters: EventFilters, page: { limit: number; offset: number }) {
    const [items, total] = await this.filteredQuery(filters)
      .orderBy('event.occurredAt', 'DESC')
      .take(page.limit)
      .skip(page.offset)
      .getManyAndCount();
    return { items, total };
  }

  findById(id: string): Promise<HazardEventEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async summary(filters: EventFilters): Promise<EventSummary> {
    const countBy = async (column: 'severity' | 'hazardType' | 'province') => {
      const rows = await this.filteredQuery(filters)
        .select(`event.${column}`, 'key')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy(`event.${column}`)
        .getRawMany<{ key: string | null; count: number }>();
      return Object.fromEntries(rows.map((row) => [row.key ?? 'Sin dato', row.count]));
    };

    const [bySeverity, byHazardType, byProvince, totals] = await Promise.all([
      countBy('severity'),
      countBy('hazardType'),
      countBy('province'),
      this.filteredQuery(filters)
        .select('COUNT(*)::int', 'total')
        .addSelect('COALESCE(SUM(event.affected), 0)::int', 'affected')
        .addSelect('COALESCE(SUM(event.housesAffected), 0)::int', 'housesAffected')
        .addSelect('COALESCE(SUM(event.evacuated), 0)::int', 'evacuated')
        .addSelect('COALESCE(SUM(event.deceased), 0)::int', 'deceased')
        .getRawOne<{ total: number; affected: number; housesAffected: number; evacuated: number; deceased: number }>(),
    ]);

    const { total = 0, ...impact } = totals ?? { affected: 0, housesAffected: 0, evacuated: 0, deceased: 0 };
    return { total, bySeverity, byHazardType, byProvince, impact };
  }

  private filteredQuery(filters: EventFilters) {
    const query = this.repository
      .createQueryBuilder('event')
      .where('event.occurredAt BETWEEN :from AND :to', { from: filters.from, to: filters.to });

    if (filters.province) query.andWhere('event.province ILIKE :province', { province: filters.province });
    if (filters.hazardTypes?.length) query.andWhere('event.hazardType IN (:...types)', { types: filters.hazardTypes });
    if (filters.severities?.length) query.andWhere('event.severity IN (:...severities)', { severities: filters.severities });
    if (filters.status) query.andWhere('event.status = :status', { status: filters.status });
    if (filters.bbox) {
      const [minLng, minLat, maxLng, maxLat] = filters.bbox;
      query.andWhere(
        'ST_Intersects(event.location, ST_MakeEnvelope(:minLng, :minLat, :maxLng, :maxLat, 4326)::geography)',
        { minLng, minLat, maxLng, maxLat },
      );
    }
    return query;
  }
}
