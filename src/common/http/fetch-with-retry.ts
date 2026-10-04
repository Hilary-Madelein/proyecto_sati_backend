import { UpstreamError } from './upstream.error.js';

export interface FetchWithRetryOptions extends RequestInit {
  /** Nombre del servicio, para los mensajes de error. */
  service: string;
  timeoutMs: number;
  /** Reintentos ante errores de red, tiempo agotado o HTTP 5xx/429. Por defecto 2. */
  retries?: number;
  /** Espera base entre reintentos; se duplica en cada intento. Por defecto 1 s. */
  retryDelayMs?: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` con tiempo límite y reintentos con espera exponencial. Devuelve la
 * respuesta solo si es 2xx; si no, lanza `UpstreamError`.
 */
export async function fetchWithRetry(url: string | URL, options: FetchWithRetryOptions): Promise<Response> {
  const { service, timeoutMs, retries = 2, retryDelayMs = 1_000, ...init } = options;
  let lastError: UpstreamError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * 2 ** (attempt - 1));

    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const reason =
        error instanceof DOMException && error.name === 'TimeoutError'
          ? `sin respuesta después de ${timeoutMs / 1000} s`
          : `error de conexión (${(error as Error).message})`;
      lastError = new UpstreamError(service, reason, undefined, { cause: error });
      continue;
    }

    if (response.ok) return response;

    lastError = new UpstreamError(service, `respondió HTTP ${response.status}`, response.status);
    if (!RETRYABLE_STATUS.has(response.status)) break;
  }

  throw lastError!;
}
