import { BadRequestException, ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service.js';
import { InMemoryAdminSessionStore, InMemoryAdminUserStore } from '../../storage/memory/in-memory-admin-auth.stores.js';
import { AdminAuthService, sha256 } from './admin-auth.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { LoginThrottle } from './login-throttle.js';
import { hashPassword, passwordProblem, verifyPassword } from './password-hasher.js';

const PASSWORD = 'clave-segura-2026';
const config = { get: () => 8 } as unknown as AppConfigService;

async function build() {
  const sessions = new InMemoryAdminSessionStore();
  const users = new InMemoryAdminUserStore(sessions);
  const auth = new AdminAuthService(users, sessions, config);
  const admins = new AdminUsersService(users, sessions);
  const ana = await admins.create({ name: 'Ana', email: 'ana@ejemplo.ec', password: PASSWORD }, { temporaryPassword: false });
  return { sessions, users, auth, admins, ana };
}

describe('password-hasher', () => {
  it('verifica la contraseña correcta y rechaza las demás', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('otra-clave-123', hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'texto-plano')).toBe(false);
  });

  it('cada hash lleva su propia sal', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('exige contraseñas razonables', () => {
    expect(passwordProblem('corta')).toMatch(/al menos 10/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/repetitiva/);
    expect(passwordProblem('hilary.calva2026', 'hilary.calva@ejemplo.ec')).toMatch(/correo/);
    expect(passwordProblem(PASSWORD, 'ana@ejemplo.ec')).toBeNull();
  });
});

describe('LoginThrottle', () => {
  it('bloquea un correo tras 5 fallos y lo libera al pasar el bloqueo', () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < 4; i++) throttle.recordFailure('ana');
    expect(throttle.lockedFor('ana')).toBe(0);
    throttle.recordFailure('ana');
    expect(throttle.lockedFor('ana')).toBeGreaterThan(0);
    expect(throttle.lockedFor('luis')).toBe(0);
    now += 15 * 60 * 1000;
    expect(throttle.lockedFor('ana')).toBe(0);
  });

  it('un acceso correcto reinicia la cuenta de fallos', () => {
    const throttle = new LoginThrottle(() => 0);
    for (let i = 0; i < 4; i++) throttle.recordFailure('ana');
    throttle.recordSuccess('ana');
    throttle.recordFailure('ana');
    expect(throttle.lockedFor('ana')).toBe(0);
  });
});

describe('AdminAuthService', () => {
  it('inicia sesión, guarda solo el hash del token y lo autentica', async () => {
    const { auth, sessions } = await build();
    const result = await auth.login('ana@ejemplo.ec', PASSWORD);

    expect(result.admin).toMatchObject({ email: 'ana@ejemplo.ec', mustChangePassword: false });
    expect(result.admin).not.toHaveProperty('passwordHash');
    expect(await sessions.findByTokenHash(result.token)).toBeNull();
    expect(await sessions.findByTokenHash(sha256(result.token))).not.toBeNull();
    expect((await auth.authenticate(result.token))?.user.email).toBe('ana@ejemplo.ec');
    expect(await auth.authenticate('token-inventado')).toBeNull();
  });

  it('da el mismo error con correo inexistente, contraseña errónea o cuenta desactivada', async () => {
    const { auth, admins, ana } = await build();
    await expect(auth.login('nadie@ejemplo.ec', PASSWORD)).rejects.toThrow('Correo o contraseña incorrectos');
    await expect(auth.login('ana@ejemplo.ec', 'no-es-la-clave')).rejects.toThrow('Correo o contraseña incorrectos');

    const luis = await admins.create({ name: 'Luis', email: 'luis@ejemplo.ec', password: PASSWORD });
    await admins.update(luis.id, { active: false }, ana.id);
    await expect(auth.login('luis@ejemplo.ec', PASSWORD)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('bloquea el correo tras varios intentos fallidos, aunque luego acierte', async () => {
    const { auth } = await build();
    for (let i = 0; i < 5; i++) await auth.login('ana@ejemplo.ec', 'no-es-la-clave').catch(() => undefined);
    const error = await auth.login('ana@ejemplo.ec', PASSWORD).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it('una sesión vencida no vale y se borra', async () => {
    const { auth, sessions } = await build();
    const { token } = await auth.login('ana@ejemplo.ec', PASSWORD);
    (await sessions.findByTokenHash(sha256(token)))!.expiresAt = new Date(Date.now() - 1);
    expect(await auth.authenticate(token)).toBeNull();
    expect(await sessions.findByTokenHash(sha256(token))).toBeNull();
  });

  it('cerrar sesión invalida el token', async () => {
    const { auth } = await build();
    const { token } = await auth.login('ana@ejemplo.ec', PASSWORD);
    await auth.logout((await auth.authenticate(token))!);
    expect(await auth.authenticate(token)).toBeNull();
  });

  it('cambiar la contraseña exige la actual y cierra las demás sesiones', async () => {
    const { auth } = await build();
    const current = await auth.login('ana@ejemplo.ec', PASSWORD);
    const other = await auth.login('ana@ejemplo.ec', PASSWORD);
    const session = (await auth.authenticate(current.token))!;

    await expect(auth.changePassword(session, 'no-es-la-clave', 'nueva-clave-2026')).rejects.toThrow('actual no es correcta');
    await expect(auth.changePassword(session, PASSWORD, PASSWORD)).rejects.toBeInstanceOf(BadRequestException);

    await auth.changePassword(session, PASSWORD, 'nueva-clave-2026');
    expect(await auth.authenticate(current.token)).not.toBeNull();
    expect(await auth.authenticate(other.token)).toBeNull();
    await expect(auth.login('ana@ejemplo.ec', 'nueva-clave-2026')).resolves.toBeDefined();
  });
});

describe('AdminUsersService', () => {
  it('las cuentas creadas por otro administrador deben cambiar su contraseña', async () => {
    const { admins } = await build();
    const luis = await admins.create({ name: 'Luis', email: 'luis@ejemplo.ec', password: PASSWORD });
    expect(luis.mustChangePassword).toBe(true);
    await expect(admins.create({ name: 'Otra', email: 'luis@ejemplo.ec', password: PASSWORD })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('nadie puede desactivarse, borrarse ni reiniciarse la contraseña a sí mismo', async () => {
    const { admins, ana } = await build();
    await expect(admins.update(ana.id, { active: false }, ana.id)).rejects.toThrow('propia cuenta');
    await expect(admins.remove(ana.id, ana.id)).rejects.toThrow('propia cuenta');
    await expect(admins.resetPassword(ana.id, 'otra-clave-2026', ana.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('desactivar, reiniciar la contraseña o borrar una cuenta cierra sus sesiones', async () => {
    const { auth, admins, ana } = await build();
    const luis = await admins.create({ name: 'Luis', email: 'luis@ejemplo.ec', password: PASSWORD });

    let { token } = await auth.login('luis@ejemplo.ec', PASSWORD);
    await admins.update(luis.id, { active: false }, ana.id);
    expect(await auth.authenticate(token)).toBeNull();
    await admins.update(luis.id, { active: true }, ana.id);

    ({ token } = await auth.login('luis@ejemplo.ec', PASSWORD));
    await admins.resetPassword(luis.id, 'temporal-2026-x', ana.id);
    expect(await auth.authenticate(token)).toBeNull();
    expect((await admins.findByEmail('luis@ejemplo.ec'))?.mustChangePassword).toBe(true);

    ({ token } = await auth.login('luis@ejemplo.ec', 'temporal-2026-x'));
    await admins.remove(luis.id, ana.id);
    expect(await auth.authenticate(token)).toBeNull();
  });

  it('recuperar el acceso pone una contraseña definitiva y reactiva la cuenta', async () => {
    const { auth, admins, ana } = await build();
    const luis = await admins.create({ name: 'Luis', email: 'luis@ejemplo.ec', password: PASSWORD });
    await admins.update(luis.id, { active: false }, ana.id);
    const recovered = await admins.recover('luis@ejemplo.ec', 'recuperada-2026');
    expect(recovered).toMatchObject({ active: true, mustChangePassword: false });
    await expect(auth.login('luis@ejemplo.ec', 'recuperada-2026')).resolves.toBeDefined();
  });
});
