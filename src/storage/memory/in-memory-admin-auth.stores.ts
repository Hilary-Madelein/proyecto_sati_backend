import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { AdminSessionStore, AdminUserStore } from '../../modules/admin-auth/admin-auth-stores.js';
import { AdminSessionEntity } from '../../modules/admin-auth/entities/admin-session.entity.js';
import { AdminUserEntity } from '../../modules/admin-auth/entities/admin-user.entity.js';
import { JsonFilePersistence } from './json-file-persistence.js';

const USERS = 'admin-users';
const SESSIONS = 'admin-sessions';

type StoredUser = Omit<AdminUserEntity, 'createdAt' | 'updatedAt' | 'lastLoginAt'> & {
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};
type StoredSession = Omit<AdminSessionEntity, 'createdAt' | 'expiresAt'> & { createdAt: string; expiresAt: string };

@Injectable()
export class InMemoryAdminSessionStore extends AdminSessionStore {
  private readonly sessions = new Map<string, AdminSessionEntity>();

  constructor(@Optional() private readonly persistence?: JsonFilePersistence) {
    super();
    for (const stored of persistence?.load<StoredSession[]>(SESSIONS) ?? []) {
      this.sessions.set(
        stored.id,
        Object.assign(new AdminSessionEntity(), stored, {
          createdAt: new Date(stored.createdAt),
          expiresAt: new Date(stored.expiresAt),
        }),
      );
    }
  }

  async create(session: AdminSessionEntity): Promise<AdminSessionEntity> {
    Object.assign(session, { id: randomUUID(), createdAt: new Date() });
    this.sessions.set(session.id, session);
    this.persist();
    return session;
  }

  async findByTokenHash(tokenHash: string): Promise<AdminSessionEntity | null> {
    return [...this.sessions.values()].find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async delete(id: string): Promise<void> {
    if (this.sessions.delete(id)) this.persist();
  }

  async deleteByUser(userId: string, exceptId?: string): Promise<void> {
    this.deleteWhere((session) => session.userId === userId && session.id !== exceptId);
  }

  async deleteExpired(now: Date): Promise<void> {
    this.deleteWhere((session) => session.expiresAt.getTime() <= now.getTime());
  }

  private deleteWhere(matches: (session: AdminSessionEntity) => boolean): void {
    const before = this.sessions.size;
    for (const [id, session] of this.sessions) if (matches(session)) this.sessions.delete(id);
    if (this.sessions.size !== before) this.persist();
  }

  private persist(): void {
    this.persistence?.save(SESSIONS, () => [...this.sessions.values()]);
  }
}

@Injectable()
export class InMemoryAdminUserStore extends AdminUserStore {
  private readonly users = new Map<string, AdminUserEntity>();

  constructor(
    private readonly sessions: InMemoryAdminSessionStore,
    @Optional() private readonly persistence?: JsonFilePersistence,
  ) {
    super();
    for (const stored of persistence?.load<StoredUser[]>(USERS) ?? []) {
      this.users.set(
        stored.id,
        Object.assign(new AdminUserEntity(), stored, {
          createdAt: new Date(stored.createdAt),
          updatedAt: new Date(stored.updatedAt),
          lastLoginAt: stored.lastLoginAt ? new Date(stored.lastLoginAt) : null,
        }),
      );
    }
  }

  async list(): Promise<AdminUserEntity[]> {
    return [...this.users.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async count(): Promise<number> {
    return this.users.size;
  }

  async findById(id: string): Promise<AdminUserEntity | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<AdminUserEntity | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async save(user: AdminUserEntity): Promise<AdminUserEntity> {
    const now = new Date();
    if (!user.id) Object.assign(user, { id: randomUUID(), createdAt: now });
    user.updatedAt = now;
    this.users.set(user.id, user);
    this.persist();
    return user;
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.users.delete(id);
    if (existed) {
      await this.sessions.deleteByUser(id);
      this.persist();
    }
    return existed;
  }

  private persist(): void {
    this.persistence?.save(USERS, () => [...this.users.values()]);
  }
}
