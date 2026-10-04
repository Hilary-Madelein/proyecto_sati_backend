interface Entry<T> {
  expiresAt: number;
  value: Promise<T>;
}

/**
 * Caché en memoria con vencimiento. Comparte la misma promesa entre pedidos
 * simultáneos (un solo viaje al servicio externo) y descarta los errores para
 * que el siguiente pedido vuelva a intentar.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }

    const value = load();
    this.entries.set(key, { expiresAt: Date.now() + this.ttlMs, value });
    value.catch(() => this.entries.delete(key));
    return value;
  }
}
