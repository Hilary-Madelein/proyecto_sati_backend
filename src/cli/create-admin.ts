/**
 * Crea una cuenta de administración desde la consola:
 *
 *   npm run admin:create
 *
 * Sirve para la primera cuenta (las demás se crean desde el panel) y para
 * recuperar el acceso si nadie recuerda su contraseña. La contraseña se
 * escribe sin mostrarse y no queda en el historial de la terminal.
 * Usa el mismo almacenamiento que el servidor (STORAGE y DATABASE_URL del .env).
 */
import { HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline/promises';
import { AppConfigModule } from '../config/config.module.js';
import { AdminUsersService } from '../modules/admin-auth/admin-users.service.js';
import { PASSWORD_MIN_LENGTH } from '../modules/admin-auth/password-hasher.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [AppConfigModule, ...StorageModule.forRoot()],
  providers: [AdminUsersService],
})
class CreateAdminModule {}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lee una línea sin mostrar lo que se escribe. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('Cancelado'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function askNewPassword(): Promise<string> {
  for (;;) {
    const password = await askHidden(`Contraseña (mínimo ${PASSWORD_MIN_LENGTH} caracteres): `);
    if ((await askHidden('Repite la contraseña: ')) === password) return password;
    console.log('No coinciden. Inténtalo otra vez.\n');
  }
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY) throw new Error('Ejecuta este comando en una terminal interactiva');

  const app = await NestFactory.createApplicationContext(CreateAdminModule, { logger: ['error'] });
  try {
    const users = app.get(AdminUsersService);
    if (process.env.STORAGE !== 'postgres') {
      console.log('Aviso: STORAGE=memory. Detén el servidor antes de continuar o no verá la cuenta nueva.\n');
    }

    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const email = (await prompt.question('Correo: ')).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new Error('Correo no válido');

    const existing = await users.findByEmail(email);
    if (existing) {
      const answer = await prompt.question(`Ya existe la cuenta de ${existing.name}. ¿Ponerle una contraseña nueva? (s/N): `);
      prompt.close();
      if (answer.trim().toLowerCase() !== 's') return;
      await users.recover(email, await askNewPassword());
      console.log(`\nListo: ${email} ya puede entrar con la contraseña nueva. Sus sesiones anteriores se cerraron.`);
      return;
    }

    const name = (await prompt.question('Nombre: ')).trim();
    prompt.close();
    if (name.length < 2 || name.length > 120) throw new Error('El nombre debe tener entre 2 y 120 caracteres');

    await users.create({ name, email, password: await askNewPassword() }, { temporaryPassword: false });
    console.log(`\nListo: cuenta creada para ${name} <${email}>. Entra en /admin del frontend.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof HttpException ? error.message : (error as Error).message;
  console.error(`\nNo se pudo crear la cuenta: ${message}`);
  process.exitCode = 1;
});
