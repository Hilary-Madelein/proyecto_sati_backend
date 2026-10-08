import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Not, Repository } from 'typeorm';
import { AdminSessionStore, AdminUserStore } from '../../modules/admin-auth/admin-auth-stores.js';
import { AdminSessionEntity } from '../../modules/admin-auth/entities/admin-session.entity.js';
import { AdminUserEntity } from '../../modules/admin-auth/entities/admin-user.entity.js';

@Injectable()
export class TypeOrmAdminUserStore extends AdminUserStore {
  constructor(@InjectRepository(AdminUserEntity) private readonly repository: Repository<AdminUserEntity>) {
    super();
  }

  list(): Promise<AdminUserEntity[]> {
    return this.repository.find({ order: { createdAt: 'ASC' } });
  }

  count(): Promise<number> {
    return this.repository.count();
  }

  findById(id: string): Promise<AdminUserEntity | null> {
    return this.repository.findOneBy({ id });
  }

  findByEmail(email: string): Promise<AdminUserEntity | null> {
    return this.repository.findOneBy({ email });
  }

  save(user: AdminUserEntity): Promise<AdminUserEntity> {
    return this.repository.save(user);
  }

  /** Las sesiones se borran solas (ON DELETE CASCADE). */
  async delete(id: string): Promise<boolean> {
    return ((await this.repository.delete({ id })).affected ?? 0) > 0;
  }
}

@Injectable()
export class TypeOrmAdminSessionStore extends AdminSessionStore {
  constructor(@InjectRepository(AdminSessionEntity) private readonly repository: Repository<AdminSessionEntity>) {
    super();
  }

  create(session: AdminSessionEntity): Promise<AdminSessionEntity> {
    return this.repository.save(session);
  }

  findByTokenHash(tokenHash: string): Promise<AdminSessionEntity | null> {
    return this.repository.findOneBy({ tokenHash });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  async deleteByUser(userId: string, exceptId?: string): Promise<void> {
    await this.repository.delete(exceptId ? { userId, id: Not(exceptId) } : { userId });
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.repository.delete({ expiresAt: LessThanOrEqual(now) });
  }
}
