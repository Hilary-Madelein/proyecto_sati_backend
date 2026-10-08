import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Hash de contraseñas con scrypt (incluido en Node, sin dependencias). Cada
 * hash lleva su sal y sus parámetros: "scrypt$N$r$p$sal$hash", así se pueden
 * endurecer los parámetros más adelante sin invalidar los hashes existentes.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  // scrypt usa 128·N·r bytes de memoria; se da margen sobre ese valor.
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Compara en tiempo constante. Un hash con otro formato nunca coincide. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Reglas de una contraseña nueva. Devuelve el problema, o null si es válida. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`;
  if (password.length > PASSWORD_MAX_LENGTH) return `La contraseña no puede tener más de ${PASSWORD_MAX_LENGTH} caracteres`;
  if (new Set(password).size < 4) return 'La contraseña es demasiado repetitiva';
  const user = email?.split('@')[0]?.toLowerCase() ?? '';
  if (user.length >= 4 && password.toLowerCase().includes(user)) return 'La contraseña no debe contener el correo';
  return null;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
