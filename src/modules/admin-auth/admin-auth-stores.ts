import type { AdminSessionEntity } from './entities/admin-session.entity.js';
import type { AdminUserEntity } from './entities/admin-user.entity.js';

/**
 * Contratos de almacenamiento de cuentas y sesiones de administración. Como
 * los demás, tienen una implementación en memoria y otra en PostgreSQL.
 */
export abstract class AdminUserStore {
  /** Todas, de la más antigua a la más reciente. */
  abstract list(): Promise<AdminUserEntity[]>;
  abstract count(): Promise<number>;
  abstract findById(id: string): Promise<AdminUserEntity | null>;
  /** `email` ya en minúsculas. */
  abstract findByEmail(email: string): Promise<AdminUserEntity | null>;
  /** Crea (sin id) o actualiza; devuelve la entidad con id y fechas. */
  abstract save(user: AdminUserEntity): Promise<AdminUserEntity>;
  /** true si existía. Sus sesiones también se borran. */
  abstract delete(id: string): Promise<boolean>;
}

export abstract class AdminSessionStore {
  abstract create(session: AdminSessionEntity): Promise<AdminSessionEntity>;
  abstract findByTokenHash(tokenHash: string): Promise<AdminSessionEntity | null>;
  abstract delete(id: string): Promise<void>;
  /** Cierra todas las sesiones de una cuenta, salvo `exceptId` (la actual). */
  abstract deleteByUser(userId: string, exceptId?: string): Promise<void>;
  abstract deleteExpired(now: Date): Promise<void>;
}
