import type { AppConfigService } from '../../config/app-config.service.js';
import { jwtExpiresAt, SngrClient } from './sngr.client.js';

const LOGIN_URL = 'https://sngr.example/api/usuarios/login';
const EVENTS_URL = 'https://sngr.example/api/public/eventos_lluvias';
const SECRET = 'clave-de-prueba';
const RANGE = { from: '2026-09-01', to: '2026-09-30' };

const config = {
  get: (key: string) =>
    ({
      SNGR_LOGIN_URL: LOGIN_URL,
      SNGR_EVENTS_URL: EVENTS_URL,
      SNGR_USUARIO: 'usuario',
      SNGR_CLAVE: SECRET,
      SNGR_TIMEOUT_MS: 1_000,
    })[key],
} as unknown as AppConfigService;

/** JWT sin firma válida: el cliente solo lee `exp`. */
function fakeJwt(expSeconds: number, id = 'a'): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds, id })).toString('base64url');
  return `header.${payload}.firma`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

describe('SngrClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init?.body)) }));
  const logins = () => calls().filter(({ url }) => url === LOGIN_URL).length;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('inicia sesión y consulta con el token y las fechas', async () => {
    const token = fakeJwt(inOneHour());
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token }))
      .mockResolvedValueOnce(json({ success: true, count: 1, data: [{ Evento: 'Inundación' }] }));

    const data = await new SngrClient(config).fetchRainEvents(RANGE);

    expect(data).toEqual([{ Evento: 'Inundación' }]);
    expect(calls()).toEqual([
      { url: LOGIN_URL, body: { usuario: 'usuario', clave: SECRET } },
      { url: EVENTS_URL, body: { token, fecha_ini: '2026-09-01', fecha_fin: '2026-09-30' } },
    ]);
  });

  it('reutiliza el token mientras no venza', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token: fakeJwt(inOneHour()) }))
      .mockImplementation(async () => json({ success: true, count: 0, data: [] }));

    const client = new SngrClient(config);
    await client.fetchRainEvents(RANGE);
    await client.fetchRainEvents(RANGE);

    expect(logins()).toBe(1);
  });

  it('inicia sesión otra vez si el token está por vencer', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token: fakeJwt(Math.floor(Date.now() / 1000) + 30) }))
      .mockResolvedValueOnce(json({ success: true, count: 0, data: [] }))
      .mockResolvedValueOnce(json({ success: true, token: fakeJwt(inOneHour(), 'b') }))
      .mockResolvedValueOnce(json({ success: true, count: 0, data: [] }));

    const client = new SngrClient(config);
    await client.fetchRainEvents(RANGE);
    await client.fetchRainEvents(RANGE);

    expect(logins()).toBe(2);
  });

  it('ante un 401 renueva el token y reintenta una vez', async () => {
    const renewed = fakeJwt(inOneHour(), 'b');
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token: fakeJwt(inOneHour()) }))
      .mockResolvedValueOnce(json({ message: 'Token expirado' }, 401))
      .mockResolvedValueOnce(json({ success: true, token: renewed }))
      .mockResolvedValueOnce(json({ success: true, count: 0, data: [] }));

    await expect(new SngrClient(config).fetchRainEvents(RANGE)).resolves.toEqual([]);
    expect(calls().at(-1)?.body.token).toBe(renewed);
  });

  it.each([
    ['403', () => json({ message: 'Prohibido' }, 403)],
    ['success: false con HTTP 200', () => json({ success: false, descripcion: 'Token inválido' })],
  ])('ante %s también renueva el token y reintenta una vez', async (_case, rejection) => {
    const renewed = fakeJwt(inOneHour(), 'b');
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token: fakeJwt(inOneHour()) }))
      .mockResolvedValueOnce(rejection())
      .mockResolvedValueOnce(json({ success: true, token: renewed }))
      .mockResolvedValueOnce(json({ success: true, count: 0, data: [] }));

    await expect(new SngrClient(config).fetchRainEvents(RANGE)).resolves.toEqual([]);
    expect(calls().at(-1)?.body.token).toBe(renewed);
  });

  it('no reintenta sin fin si la API rechaza también el token nuevo', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url) === LOGIN_URL ? json({ success: true, token: fakeJwt(inOneHour()) }) : json({}, 401),
    );

    await expect(new SngrClient(config).fetchRainEvents(RANGE)).rejects.toThrow('rechazó un token recién emitido');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('un token sin vencimiento se reutiliza hasta que la API lo rechace', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token: 'token-opaco' }))
      .mockResolvedValueOnce(json({ success: true, count: 0, data: [] }))
      .mockResolvedValueOnce(json({ success: true, count: 0, data: [] }))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ success: true, token: 'token-nuevo' }))
      .mockResolvedValueOnce(json({ success: true, count: 0, data: [] }));

    const client = new SngrClient(config);
    await client.fetchRainEvents(RANGE);
    await client.fetchRainEvents(RANGE);
    await client.fetchRainEvents(RANGE);

    expect(logins()).toBe(2);
    expect(calls().at(-1)?.body.token).toBe('token-nuevo');
  });

  it('consultas simultáneas comparten un solo login', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url) === LOGIN_URL
        ? json({ success: true, token: fakeJwt(inOneHour()) })
        : json({ success: true, count: 0, data: [] }),
    );

    const client = new SngrClient(config);
    await Promise.all([client.fetchRainEvents(RANGE), client.fetchRainEvents(RANGE), client.fetchRainEvents(RANGE)]);

    expect(logins()).toBe(1);
  });

  it('informa credenciales rechazadas sin mostrar la clave', async () => {
    fetchMock.mockResolvedValue(json({ success: false, descripcion: 'Usuario no encontrado' }, 404));

    const error = await new SngrClient(config).fetchRainEvents(RANGE).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('revisa SNGR_USUARIO y SNGR_CLAVE');
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('rechaza un login exitoso sin token', async () => {
    fetchMock.mockResolvedValue(json({ success: false }));
    await expect(new SngrClient(config).fetchRainEvents(RANGE)).rejects.toThrow('inicio de sesión rechazado');
  });

  it('rechaza una consulta sin la lista "data"', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token: fakeJwt(inOneHour()) }))
      .mockResolvedValueOnce(json({ success: true, count: 0 }));
    await expect(new SngrClient(config).fetchRainEvents(RANGE)).rejects.toThrow('falta la lista "data"');
  });
});

describe('jwtExpiresAt', () => {
  it('lee el vencimiento en milisegundos', () => {
    expect(jwtExpiresAt(fakeJwt(1_800_000_000))).toBe(1_800_000_000_000);
  });

  it.each(['no-es-jwt', 'a.%%%.c', `a.${Buffer.from('{}').toString('base64url')}.c`])('devuelve null para %s', (token) => {
    expect(jwtExpiresAt(token)).toBeNull();
  });
});
