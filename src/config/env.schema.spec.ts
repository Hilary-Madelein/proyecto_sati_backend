import { envSchema } from './env.schema.js';

const base = { SNGR_ENABLED: 'false', SNGR_URL: 'https://example.org/ws' };

describe('envSchema · PORT', () => {
  it('usa 4000 por defecto', () => {
    expect(envSchema.parse(base).PORT).toBe(4000);
  });

  it.each(['6000', '5060', '6667'])('rechaza el puerto %s, bloqueado por fetch', (port) => {
    const result = envSchema.safeParse({ ...base, PORT: port });
    expect(result.success).toBe(false);
  });
});
