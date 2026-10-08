import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSessionStore, AdminUserStore } from './admin-auth-stores.js';
import { AdminUserEntity, toAdminUserView, type AdminUserView } from './entities/admin-user.entity.js';
import { hashPassword, passwordProblem } from './password-hasher.js';

export interface NewAdminUser {
  name: string;
  email: string;
  password: string;
}

/**
 * Alta, edición y baja de cuentas de administración. Las contraseñas que pone
 * otro administrador son temporales: la persona debe cambiarla al entrar.
 * Nadie puede desactivarse ni borrarse a sí mismo, así siempre queda al menos
 * una cuenta activa.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: AdminUserStore,
    private readonly sessions: AdminSessionStore,
  ) {}

  async list(): Promise<AdminUserView[]> {
    return (await this.users.list()).map(toAdminUserView);
  }

  count(): Promise<number> {
    return this.users.count();
  }

  /** `temporaryPassword` = la puso otro administrador (por defecto). La primera cuenta, creada por consola, no lo es. */
  async create(input: NewAdminUser, options: { temporaryPassword?: boolean } = {}): Promise<AdminUserView> {
    if (await this.users.findByEmail(input.email)) throw new ConflictException(`Ya existe una cuenta con el correo ${input.email}`);
    assertPassword(input.password, input.email);
    const user = await this.users.save(
      Object.assign(new AdminUserEntity(), {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        active: true,
        mustChangePassword: options.temporaryPassword ?? true,
        lastLoginAt: null,
      }),
    );
    return toAdminUserView(user);
  }

  async update(id: string, changes: { name?: string; active?: boolean }, actorId: string): Promise<AdminUserView> {
    const user = await this.get(id);
    if (changes.active === false && id === actorId) throw new BadRequestException('No puedes desactivar tu propia cuenta');
    if (changes.name !== undefined) user.name = changes.name;
    if (changes.active !== undefined) user.active = changes.active;
    await this.users.save(user);
    if (!user.active) await this.sessions.deleteByUser(user.id);
    return toAdminUserView(user);
  }

  /** Pone una contraseña temporal a otra cuenta y cierra sus sesiones. */
  async resetPassword(id: string, password: string, actorId: string): Promise<void> {
    if (id === actorId) throw new BadRequestException('Para tu propia cuenta usa «Cambiar contraseña»');
    const user = await this.get(id);
    assertPassword(password, user.email);
    user.passwordHash = await hashPassword(password);
    user.mustChangePassword = true;
    await this.users.save(user);
    await this.sessions.deleteByUser(user.id);
  }

  /**
   * Recupera el acceso desde la consola (sin sesión): nueva contraseña
   * definitiva, cuenta activa y todas sus sesiones cerradas.
   */
  async recover(email: string, password: string): Promise<AdminUserView> {
    const user = await this.users.findByEmail(email);
    if (!user) throw new NotFoundException(`No existe una cuenta con el correo ${email}`);
    assertPassword(password, user.email);
    Object.assign(user, { passwordHash: await hashPassword(password), mustChangePassword: false, active: true });
    await this.users.save(user);
    await this.sessions.deleteByUser(user.id);
    return toAdminUserView(user);
  }

  async findByEmail(email: string): Promise<AdminUserView | null> {
    const user = await this.users.findByEmail(email);
    return user && toAdminUserView(user);
  }

  async remove(id: string, actorId: string): Promise<void> {
    if (id === actorId) throw new BadRequestException('No puedes eliminar tu propia cuenta');
    if (!(await this.users.delete(id))) throw new NotFoundException(`No existe la cuenta ${id}`);
  }

  private async get(id: string): Promise<AdminUserEntity> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException(`No existe la cuenta ${id}`);
    return user;
  }
}

function assertPassword(password: string, email: string): void {
  const problem = passwordProblem(password, email);
  if (problem) throw new BadRequestException(problem);
}
