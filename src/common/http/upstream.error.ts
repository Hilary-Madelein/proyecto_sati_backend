/** Error al hablar con un servicio externo (SNGR, GeoServer, …). */
export class UpstreamError extends Error {
  constructor(
    /** Nombre corto del servicio, para logs y respuestas. */
    readonly service: string,
    message: string,
    /** Código HTTP devuelto por el servicio, si llegó a responder. */
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`[${service}] ${message}`, options);
    this.name = 'UpstreamError';
  }
}
