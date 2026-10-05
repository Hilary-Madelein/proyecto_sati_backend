import { mapWithConcurrency } from './map-with-concurrency.js';

describe('mapWithConcurrency', () => {
  it('conserva el orden y nunca supera el límite de tareas simultáneas', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (delay, index) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, delay));
      running--;
      return index * 10;
    });

    expect(results).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it('falla con el primer error', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error('falló');
        return value;
      }),
    ).rejects.toThrow('falló');
  });

  it('devuelve una lista vacía sin llamar a la función', async () => {
    const fn = vi.fn();
    await expect(mapWithConcurrency([], 3, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
