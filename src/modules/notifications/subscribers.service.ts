import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { toOfficialProvince } from '../../common/geo/ecuador-provinces.js';
import type { CreateSubscriberDto, UpdateSubscriberDto } from './dto/subscriber.dto.js';
import { NotificationSubscriberEntity } from './entities/notification-subscriber.entity.js';
import { SubscriberStore } from './notification-stores.js';

/** Alta, edición y baja de suscriptores, con sus validaciones. */
@Injectable()
export class SubscribersService {
  constructor(private readonly store: SubscriberStore) {}

  list(): Promise<NotificationSubscriberEntity[]> {
    return this.store.list();
  }

  async get(id: string): Promise<NotificationSubscriberEntity> {
    const subscriber = await this.store.findById(id);
    if (!subscriber) throw new NotFoundException(`No existe el suscriptor ${id}`);
    return subscriber;
  }

  async create(dto: CreateSubscriberDto): Promise<NotificationSubscriberEntity> {
    await this.assertEmailFree(dto.email);
    return this.store.save(
      Object.assign(new NotificationSubscriberEntity(), {
        name: dto.name,
        email: dto.email,
        provinces: officialProvinces(dto.provinces ?? []),
        minSeverity: dto.minSeverity ?? 'high',
        active: dto.active ?? true,
      }),
    );
  }

  async update(id: string, dto: UpdateSubscriberDto): Promise<NotificationSubscriberEntity> {
    const subscriber = await this.get(id);
    if (dto.email && dto.email !== subscriber.email) await this.assertEmailFree(dto.email);
    return this.store.save(
      Object.assign(subscriber, {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.provinces !== undefined && { provinces: officialProvinces(dto.provinces) }),
        ...(dto.minSeverity !== undefined && { minSeverity: dto.minSeverity }),
        ...(dto.active !== undefined && { active: dto.active }),
      }),
    );
  }

  async remove(id: string): Promise<void> {
    if (!(await this.store.delete(id))) throw new NotFoundException(`No existe el suscriptor ${id}`);
  }

  private async assertEmailFree(email: string): Promise<void> {
    if (await this.store.findByEmail(email)) throw new ConflictException(`Ya existe un suscriptor con el correo ${email}`);
  }
}

/** Nombres oficiales, sin repetidos. Rechaza las provincias que no existen. */
function officialProvinces(names: string[]): string[] {
  const unknown = names.filter((name) => !toOfficialProvince(name));
  if (unknown.length > 0) {
    throw new BadRequestException(`Provincias desconocidas: ${unknown.join(', ')}. Ver GET /notifications/provinces`);
  }
  return [...new Set(names.map((name) => toOfficialProvince(name)!))];
}
