import { envSchema } from './env.schema.js';

const base = { SNGR_ENABLED: 'false' };

describe('envSchema · PORT', () => {
  it('usa 4000 por defecto', () => {
    expect(envSchema.parse(base).PORT).toBe(4000);
  });

  it.each(['6000', '5060', '6667'])('rechaza el puerto %s, bloqueado por fetch', (port) => {
    const result = envSchema.safeParse({ ...base, PORT: port });
    expect(result.success).toBe(false);
  });
});

describe('envSchema · SNGR', () => {
  it('exige usuario y clave cuando la SNGR está habilitada', () => {
    const result = envSchema.safeParse({ SNGR_ENABLED: 'true', SNGR_USUARIO: 'usuario' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['SNGR_CLAVE']);
  });

  it('usa las URLs de la API de monitoreo del COE por defecto', () => {
    const env = envSchema.parse(base);
    expect(env.SNGR_LOGIN_URL).toBe('https://monitoreocoe.gestionderiesgos.gob.ec/api/usuarios/login');
    expect(env.SNGR_EVENTS_URL).toBe('https://monitoreocoe.gestionderiesgos.gob.ec/api/public/eventos_lluvias');
  });
});

describe('envSchema · correo', () => {
  it('funciona sin SMTP (los correos van al log)', () => {
    expect(envSchema.safeParse(base).success).toBe(true);
  });

  it('exige remitente y contraseña cuando hay servidor y usuario', () => {
    const result = envSchema.safeParse({ ...base, SMTP_HOST: 'smtp.ejemplo.ec', SMTP_USER: 'alertas' });
    expect(result.error?.issues.map((issue) => issue.path.join('.')).sort()).toEqual(['MAIL_FROM', 'SMTP_PASS']);
  });
});
