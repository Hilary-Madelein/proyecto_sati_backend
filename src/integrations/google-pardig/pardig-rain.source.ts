import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { createZstdDecompress } from 'node:zlib';
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { ObservedRainProduct } from '../../modules/observed-rain/observed-rain-source.js';
import { FRAME_MS, FrameCropper, HOUR_MS, frameFolder, framesOfHour, hourlyGrid } from './pardig-grid.js';

const SERVICE = 'PARDIG (Google)';
const MINUTE_MS = 60 * 1000;
/** Horas hacia atrás que se tienen en memoria: la ventana más larga que se ofrece (72 h) y un margen. */
const KEEP_HOURS = 74;
/** Cada cuánto se busca si hay imágenes nuevas (sale una cada 15 minutos). */
const REFRESH_MS = 10 * MINUTE_MS;
/** La primera carga espera a que el servidor termine de arrancar y de hacer sus primeros cálculos. */
const FIRST_RUN_DELAY_MS = 3 * MINUTE_MS;
/** Hacia atrás desde ahora, cuántas imágenes se prueban para encontrar la más reciente (el dato llega con unas 6 horas de retraso). */
const MAX_PROBES = 24 * 4;
/** Pausa entre imágenes: se bajan de una en una y dejando respirar al servidor, que es pequeño. */
const PAUSE_MS = 250;
const TIMEOUT_MS = 30_000;
/**
 * Seguro: si el proceso ya ocupa esta memoria (MB), no se bajan más imágenes en esa
 * vuelta. El servidor de producción tiene 512 MB y se reinicia si los pasa; es
 * preferible quedarse con menos horas de PARDIG que tumbar el resto del sistema.
 */
const MAX_RSS_MB = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const PARDIG_PRODUCT: ObservedRainProduct = {
  key: 'pardig',
  name: 'PARDIG',
  attribution: 'Lluvia observada: PARDIG · Google DeepMind (CC BY 4.0)',
};

/**
 * Lluvia estimada PARDIG de Google DeepMind, leída del almacén público de Google
 * Cloud Storage (sin clave). Cada 15 minutos se publica una imagen mundial; aquí
 * se baja en segundo plano y solo se guarda, en memoria, su recorte del Ecuador
 * (nada en disco). Las consultas responden con lo ya cargado y nunca esperan una
 * descarga.
 *
 * El servidor de producción tiene poca memoria y poco procesador: las imágenes se
 * bajan de una en una, se descomprimen a medida que llegan (sin tener nunca los
 * 26 MB de la imagen entera) y se deja de leer en cuanto pasa el Ecuador. Tras
 * arrancar, las últimas 24 h quedan listas en unos minutos y las 72 h, después.
 */
@Injectable()
export class PardigRainSource implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PardigRainSource.name);
  /** Intensidad (mm/h) de cada imagen por su hora; null = Google no la publicó. */
  private readonly frames = new Map<number, Float32Array | null>();
  private latest: number | null = null;
  private refreshing: Promise<void> | null = null;
  private stopped = false;
  private refreshTimer?: NodeJS.Timeout;
  private firstRunTimer?: NodeJS.Timeout;

  constructor(private readonly config: AppConfigService) {}

  onApplicationBootstrap(): void {
    if (!this.baseUrl) return;
    this.firstRunTimer = setTimeout(() => this.refreshInBackground(), FIRST_RUN_DELAY_MS);
    this.refreshTimer = setInterval(() => this.refreshInBackground(), REFRESH_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.firstRunTimer);
    clearInterval(this.refreshTimer);
  }

  /** Horas completas ya cargadas (ISO 8601, la hora en que termina cada una), de la más antigua a la más reciente. */
  hourlyTimes(): string[] {
    if (this.latest === null) return [];
    const times: string[] = [];
    const lastHour = Math.floor(this.latest / HOUR_MS) * HOUR_MS;
    for (let hour = lastHour - (KEEP_HOURS - 1) * HOUR_MS; hour <= lastHour; hour += HOUR_MS) {
      if (this.gridOf(hour)) times.push(new Date(hour).toISOString());
    }
    return times;
  }

  /** Lluvia (mm) de la hora que termina en `time`. */
  hourlyGrid(time: string): RasterGrid {
    const grid = this.gridOf(Date.parse(time));
    if (!grid) throw new UpstreamError(SERVICE, `no hay datos para ${time}`);
    return grid;
  }

  private gridOf(hourEnd: number): RasterGrid | null {
    return hourlyGrid(framesOfHour(hourEnd).map((time) => this.frames.get(time)));
  }

  private get baseUrl(): string | undefined {
    return this.config.get('PARDIG_BASE_URL');
  }

  private refreshInBackground(): void {
    this.refreshing ??= this.refresh()
      .catch((error: unknown) => this.logger.warn(`No se pudo actualizar PARDIG: ${(error as Error).message}`))
      .finally(() => (this.refreshing = null));
  }

  /** Busca la imagen más reciente y baja las que falten, de la más nueva a la más vieja, de una en una. */
  async refresh(now = Date.now()): Promise<void> {
    const latest = await this.findLatest(now);
    if (latest === null) {
      this.logger.warn('PARDIG no tiene imágenes recientes');
      return;
    }
    this.latest = latest;
    const oldest = Math.floor(latest / HOUR_MS) * HOUR_MS - KEEP_HOURS * HOUR_MS + FRAME_MS;
    for (const time of this.frames.keys()) if (time < oldest) this.frames.delete(time);

    let loaded = 0;
    let failed = 0;
    for (let time = latest; time >= oldest && !this.stopped; time -= FRAME_MS) {
      if (this.frames.has(time)) continue;
      const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      if (rssMb > MAX_RSS_MB) {
        this.logger.warn(`PARDIG: carga en pausa, el servidor ocupa ${rssMb} MB de memoria`);
        break;
      }
      try {
        this.frames.set(time, await this.download(time));
        loaded += 1;
      } catch {
        // Queda sin cargar: se vuelve a intentar en la próxima actualización.
        failed += 1;
      }
      await sleep(PAUSE_MS);
    }
    if (loaded + failed > 0) {
      this.logger.log(`PARDIG: ${loaded} imágenes nuevas hasta ${new Date(latest).toISOString()}${failed ? `, ${failed} sin bajar` : ''}`);
    }
  }

  /** La imagen terminada más reciente: se prueba hacia atrás desde ahora (o hasta la última conocida). */
  private async findLatest(now: number): Promise<number | null> {
    const start = Math.floor(now / FRAME_MS) * FRAME_MS;
    const stop = this.latest ?? start - MAX_PROBES * FRAME_MS;
    for (let time = start; time > stop; time -= FRAME_MS) {
      // Google deja un objeto "success" cuando la imagen terminó de escribirse.
      const response = await fetch(`${this.baseUrl}/${frameFolder(time)}/success`, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.ok) return time;
    }
    return this.latest;
  }

  /** Intensidad de una imagen recortada al Ecuador; null si Google no la publicó. */
  private async download(time: number): Promise<Float32Array | null> {
    const url = `${this.baseUrl}/${frameFolder(time)}/predictions.zarr/precipitation/c/0/0`;
    const abort = new AbortController();
    const response = await fetch(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
    if (response.status === 404) return null;
    if (!response.ok || !response.body) throw new UpstreamError(SERVICE, `respondió HTTP ${response.status}`, response.status);

    const cropper = new FrameCropper();
    const body = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    const decompressed = body.pipe(createZstdDecompress());
    try {
      await new Promise<void>((resolve, reject) => {
        body.on('error', reject);
        decompressed.on('error', reject);
        decompressed.on('end', resolve);
        decompressed.on('data', (chunk: Buffer) => {
          // Pasado el Ecuador no hace falta el resto de la imagen.
          if (cropper.push(chunk)) resolve();
        });
      });
    } finally {
      abort.abort();
      body.destroy();
      decompressed.destroy();
    }
    return cropper.result();
  }
}
