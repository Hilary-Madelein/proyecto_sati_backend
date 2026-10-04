/**
 * Bloqueo por fuente: evita que una misma fuente se sincronice dos veces a la
 * vez. En memoria basta para una instancia; con PostgreSQL vale también entre
 * varias instancias del backend (ver `src/storage/`).
 */
export abstract class SourceLock {
  /** Ejecuta `task` con el bloqueo tomado; devuelve null si ya estaba tomado. */
  abstract runExclusive<T>(key: string, task: () => Promise<T>): Promise<T | null>;
}
