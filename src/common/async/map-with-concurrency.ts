/**
 * Como `Promise.all(items.map(fn))`, pero con a lo sumo `limit` tareas a la vez
 * (para no saturar un servicio externo con decenas de descargas simultáneas).
 * Conserva el orden de los resultados y falla con el primer error.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error('limit debe ser al menos 1');
  const results: R[] = Array.from({ length: items.length });
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
