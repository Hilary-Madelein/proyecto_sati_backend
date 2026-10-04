import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { DateRange } from '../../common/time/ecuador-time.js';
import { AppConfigService } from '../../config/app-config.service.js';

const SERVICE = 'SNGR';

/**
 * Cliente del web service de eventos de la SNGR. La credencial solo vive aquí
 * (variables de entorno) y nunca se incluye en logs ni en mensajes de error.
 *
 * Restricciones de la API:
 * - máximo 7 días entre FechaDesde y FechaHasta (8 devuelve HTTP 400);
 * - filtra por fecha de ACTUALIZACIÓN del evento, no por fecha del evento.
 */
@Injectable()
export class SngrClient {
  /** Días máximos por consulta (inclusive). */
  static readonly MAX_DAYS_PER_REQUEST = 7;

  constructor(private readonly config: AppConfigService) {}

  /** Eventos por lluvias actualizados entre las dos fechas (AAAA-MM-DD, hora de Ecuador). */
  async fetchUpdatedBetween(range: DateRange): Promise<unknown[]> {
    const response = await fetchWithRetry(this.config.get('SNGR_URL'), {
      service: SERVICE,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        token: this.config.get('SNGR_TOKEN'),
        usuario: this.config.get('SNGR_USUARIO'),
        FechaDesde: range.from,
        FechaHasta: range.to,
        esEventoLluvia: true,
      }),
      timeoutMs: this.config.get('SNGR_TIMEOUT_MS'),
      // Es un servicio lento: un solo reintento, con espera, para no saturarlo.
      retries: 1,
      retryDelayMs: 5_000,
    });

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new UpstreamError(SERVICE, 'la respuesta no es JSON válido');
    }

    // La SNGR informa errores como texto o como [{ error: true, message }] con HTTP 200.
    if (typeof data === 'string') throw new UpstreamError(SERVICE, data);
    if (Array.isArray(data) && data.length === 1 && isErrorRecord(data[0])) {
      throw new UpstreamError(SERVICE, String(data[0].message ?? 'error de la API'));
    }
    if (!Array.isArray(data)) throw new UpstreamError(SERVICE, 'respuesta inesperada (no es una lista)');
    return data;
  }
}

function isErrorRecord(value: unknown): value is { error: unknown; message?: unknown } {
  return typeof value === 'object' && value !== null && 'error' in value && Boolean((value as { error: unknown }).error);
}
