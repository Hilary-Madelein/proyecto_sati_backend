import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { AdminSessionStore, AdminUserStore } from './admin-auth-stores.js';
import { AdminSessionEntity } from './entities/admin-session.entity.js';
import { toAdminUserView, type AdminUserEntity, type AdminUserView } from './entities/admin-user.entity.js';
import { LoginThrottle } from './login-throttle.js';
import { hashPassword, passwordProblem, verifyPassword } from './password-hasher.js';

/** Cuenta y sesión de quien hace la petición (la deja AdminSessionGuard en la request). */
export interface AdminAuth {
  user: AdminUserEntity;
  session: AdminSessionEntity;
}

export interface LoginResult {
  /** Se entrega solo aquí; el backend guarda únicamente su hash. */
  token: string;
  expiresAt: Date;
  admin: AdminUserView;
}

/** Mismo mensaje para correo inexistente, contraseña errónea o cuenta desactivada: no revela cuáles cuentas existen. */
const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos';
const TOKEN_BYTES = 32;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Inicio y cierre de sesión de administradores, y cambio de la propia contraseña. */
@Injectable()
export class AdminAuthService {
  private readonly throttle = new LoginThrottle();
  /** Hash de una contraseña al azar: se compara contra él cuando el correo no existe. */
  private decoyHash: Promise<string> | null = null;

  constructor(
    private readonly users: AdminUserStore,
    private readonly sessions: AdminSessionStore,
    private readonly config: AppConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const lockedMs = this.throttle.lockedFor(email);
    if (lockedMs > 0) {
      throw new HttpException(
        `Demasiados intentos fallidos. Espera ${Math.ceil(lockedMs / 60_000)} min y vuelve a intentarlo.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findByEmail(email);
    // Con un correo inexistente también se verifica (contra un hash señuelo):
    // así la respuesta tarda lo mismo y no delata qué correos tienen cuenta.
    const valid = await verifyPassword(password, user?.passwordHash ?? (await this.decoy()));
    if (!user || !valid || !user.active) {
      this.throttle.recordFailure(email);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    this.throttle.recordSuccess(email);

    await this.sessions.deleteExpired(new Date());
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get('ADMIN_SESSION_HOURS') * 3_600_000);
    await this.sessions.create(Object.assign(new AdminSessionEntity(), { userId: user.id, tokenHash: sha256(token), expiresAt }));

    user.lastLoginAt = new Date();
    await this.users.save(user);
    return { token, expiresAt, admin: toAdminUserView(user) };
  }

  /** Cuenta y sesión de un token, o null si no existe, venció o la cuenta está desactivada. */
  async authenticate(token: string): Promise<AdminAuth | null> {
    if (!token) return null;
    const session = await this.sessions.findByTokenHash(sha256(token));
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions.delete(session.id);
      return null;
    }
    const user = await this.users.findById(session.userId);
    return user?.active ? { user, session } : null;
  }

  async logout(auth: AdminAuth): Promise<void> {
    await this.sessions.delete(auth.session.id);
  }

  /** Cambia la propia contraseña y cierra las demás sesiones de la cuenta. */
  async changePassword(auth: AdminAuth, currentPassword: string, newPassword: string): Promise<void> {
    const { user, session } = auth;
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    if (currentPassword === newPassword) throw new BadRequestException('La nueva contraseña debe ser distinta de la actual');
    const problem = passwordProblem(newPassword, user.email);
    if (problem) throw new BadRequestException(problem);

    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    await this.users.save(user);
    await this.sessions.deleteByUser(user.id, session.id);
  }

  private decoy(): Promise<string> {
    this.decoyHash ??= hashPassword(randomBytes(TOKEN_BYTES).toString('base64url'));
    return this.decoyHash;
  }
}
