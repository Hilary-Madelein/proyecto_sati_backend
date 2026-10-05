import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { DateRange } from '../../common/time/ecuador-time.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { sngrEventsResponseSchema, sngrLoginResponseSchema } from './sngr.schema.js';

const SERVICE = 'SNGR';
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };
/** Se renueva el token un poco antes de que venza. */
const TOKEN_RENEW_MARGIN_MS = 60_000;
const LOGIN_REJECTED = 'inicio de sesión rechazado: revisa SNGR_USUARIO y SNGR_CLAVE';
/** Respuestas de la consulta que indican token ausente, inválido o vencido. */
const SESSION_REJECTED_STATUS = new Set([401, 403]);

/** La API rechazó el token: hay que iniciar sesión otra vez. */
class SessionRejectedError extends UpstreamError {}

interface SessionToken {
  value: string;
  /** Vencimiento según el JWT; null si no lo trae (se usa hasta que la API responda 401). */
  expiresAt: number | null;
}

/**
 * Cliente de la API de eventos por lluvias de la SNGR (monitoreo del COE):
 * 1. Login (`SNGR_LOGIN_URL`) con usuario y clave → token JWT.
 * 2. Consulta (`SNGR_EVENTS_URL`) con el token y el rango de fechas (inclusive).
 *
 * Ciclo del token:
 * - se guarda en memoria y se reutiliza mientras no venza;
 * - un minuto antes de su vencimiento (`exp` del JWT) se pide uno nuevo;
 * - si la consulta lo rechaza igual (401/403 o `success: false`), se inicia
 *   sesión otra vez y se reintenta UNA sola vez;
 * - si varias consultas necesitan token a la vez, se hace un solo login.
 *
 * Las credenciales y el token solo viven aquí y nunca se incluyen en logs ni en
 * mensajes de error.
 */
@Injectable()
export class SngrClient {
  private token: SessionToken | null = null;
  /** Login en curso: si varias consultas lo piden a la vez, se hace uno solo. */
  private pendingLogin: Promise<string> | null = null;

  constructor(private readonly config: AppConfigService) {}

  /** Eventos por lluvias entre las dos fechas (AAAA-MM-DD, inclusive). */
  async fetchRainEvents(range: DateRange): Promise<unknown[]> {
    const filters = { fecha_ini: range.from, fecha_fin: range.to };
    const token = await this.getToken();
    try {
      return await this.queryEvents(token, filters);
    } catch (error) {
      if (!(error instanceof SessionRejectedError)) throw error;
      // Token vencido o revocado antes de lo previsto: nueva sesión y un solo reintento.
      // Solo se descarta si sigue siendo el que falló (otra consulta pudo renovarlo ya).
      if (this.token?.value === token) this.token = null;
      try {
        return await this.queryEvents(await this.getToken(), filters);
      } catch (retryError) {
        if (retryError instanceof SessionRejectedError) {
          throw new UpstreamError(SERVICE, 'la consulta rechazó un token recién emitido', retryError.status);
        }
        throw retryError;
      }
    }
  }

  private async queryEvents(token: string, filters: { fecha_ini: string; fecha_fin: string }): Promise<unknown[]> {
    let response: Response;
    try {
      response = await this.post(this.config.get('SNGR_EVENTS_URL'), { token, ...filters });
    } catch (error) {
      if (error instanceof UpstreamError && SESSION_REJECTED_STATUS.has(error.status ?? 0)) {
        throw new SessionRejectedError(SERVICE, 'token rechazado', error.status);
      }
      throw error;
    }
    const payload = await readJson(response);
    // `success: false` con HTTP 200: se trata como sesión rechazada (se renueva y reintenta una vez).
    if ((payload as { success?: unknown } | null)?.success === false) {
      throw new SessionRejectedError(SERVICE, 'consulta sin éxito');
    }
    const parsed = sngrEventsResponseSchema.safeParse(payload);
    if (!parsed.success) throw new UpstreamError(SERVICE, 'respuesta inesperada (falta la lista "data")');
    return parsed.data.data;
  }

  private getToken(): Promise<string> {
    const token = this.token;
    if (token && (token.expiresAt === null || Date.now() < token.expiresAt - TOKEN_RENEW_MARGIN_MS)) {
      return Promise.resolve(token.value);
    }
    this.pendingLogin ??= this.login().finally(() => {
      this.pendingLogin = null;
    });
    return this.pendingLogin;
  }

  private async login(): Promise<string> {
    let response: Response;
    try {
      response = await this.post(this.config.get('SNGR_LOGIN_URL'), {
        usuario: this.config.get('SNGR_USUARIO'),
        clave: this.config.get('SNGR_CLAVE'),
      });
    } catch (error) {
      // 400: datos faltantes · 401/404: usuario o clave incorrectos.
      if (error instanceof UpstreamError && [400, 401, 404].includes(error.status ?? 0)) {
        throw new UpstreamError(SERVICE, `${LOGIN_REJECTED} (HTTP ${error.status})`, error.status);
      }
      throw error;
    }

    const parsed = sngrLoginResponseSchema.safeParse(await readJson(response));
    if (!parsed.success || parsed.data.success === false || !parsed.data.token) {
      throw new UpstreamError(SERVICE, LOGIN_REJECTED);
    }
    this.token = { value: parsed.data.token, expiresAt: jwtExpiresAt(parsed.data.token) };
    return this.token.value;
  }

  private post(url: string, body: Record<string, unknown>): Promise<Response> {
    return fetchWithRetry(url, {
      service: SERVICE,
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      timeoutMs: this.config.get('SNGR_TIMEOUT_MS'),
      // Un solo reintento, con espera, para no saturar el servicio.
      retries: 1,
      retryDelayMs: 5_000,
    });
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new UpstreamError(SERVICE, 'la respuesta no es JSON válido');
  }
}

/** Vencimiento (`exp`) de un JWT en milisegundos, sin verificar la firma. Null si no se puede leer. */
export function jwtExpiresAt(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}
