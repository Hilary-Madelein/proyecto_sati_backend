/**
 * Frena los intentos de adivinar una contraseña: tras MAX_FAILURES fallos
 * seguidos para un mismo correo, ese correo queda bloqueado LOCK_MS. Vive en
 * memoria (por instancia): suficiente para un panel con pocos usuarios.
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
/** Tope de correos vigilados, para que la memoria no crezca sin límite. */
const MAX_TRACKED = 10_000;

interface Attempts {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly attempts = new Map<string, Attempts>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milisegundos de bloqueo que faltan para este correo (0 = puede intentar). */
  lockedFor(email: string): number {
    const entry = this.attempts.get(email);
    return entry ? Math.max(0, entry.lockedUntil - this.now()) : 0;
  }

  recordFailure(email: string): void {
    const now = this.now();
    let entry = this.attempts.get(email);
    if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
      entry = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    }
    entry.failures++;
    if (entry.failures >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCK_MS;
      entry.failures = 0;
      entry.firstFailureAt = now;
    }
    this.attempts.delete(email);
    this.attempts.set(email, entry);
    if (this.attempts.size > MAX_TRACKED) this.attempts.delete(this.attempts.keys().next().value!);
  }

  recordSuccess(email: string): void {
    this.attempts.delete(email);
  }
}
