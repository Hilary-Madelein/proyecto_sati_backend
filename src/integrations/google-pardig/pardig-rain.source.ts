import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { mapWithConcurrency } from '../../common/async/map-with-concurrency.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { ObservedRainProduct } from '../../modules/observed-rain/observed-rain-source.js';
import { FRAME_MS, HOUR_MS, cropFrame, frameFolder, framesOfHour, hourlyGrid } from './pardig-grid.js';

const SERVICE = 'PARDIG (Google)';
const MINUTE_MS = 60 * 1000;
/** Horas hacia atrás que se tienen en memoria: la ventana más larga que se ofrece (72 h) y un margen. */
const KEEP_HOURS = 74;
/** Cada cuánto se busca si hay imágenes nuevas (sale una cada 15 minutos). */
const REFRESH_MS = 10 * MINUTE_MS;
const FIRST_RUN_DELAY_MS = 20 * 1000;
/** Hacia atrás desde ahora, cuántas imágenes se prueban para encontrar la más reciente (el dato llega con unas 6 horas de retraso). */
const MAX_PROBES = 24 * 4;
/**
 * Imágenes que se bajan a la vez. Cada una pesa ~1,3 MB y, descomprimida un
 * instante, 26 MB: pocas a la vez para no llenar la memoria.
 */
const DOWNLOAD_CONCURRENCY = 3;
const TIMEOUT_MS = 30_000;

const decompress = promisify(zstdDecompress);

export const PARDIG_PRODUCT: ObservedRainProduct = {
  key: 'pardig',
  name: 'PARDIG',
  attribution: 'Lluvia observada: PARDIG · Google DeepMind (CC BY 4.0)',
};

/**
 * Lluvia estimada PARDIG de Google DeepMind, leída del almacén público de Google
 * Cloud Storage (sin clave). Cada 15 minutos se publica una imagen mundial; aquí
 * se baja en segundo plano, se recorta al Ecuador y se guarda solo en memoria
 * (nada en disco): las consultas responden con lo ya cargado y nunca esperan una
 * descarga. Tras arrancar, las últimas 24 h están listas en uno o dos minutos y
 * las 72 h, unos minutos después.
 */
@Injectable()
export class PardigRainSource implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PardigRainSource.name);
  /** Intensidad (mm/h) de cada imagen por su hora; null = Google no la publicó. */
  private readonly frames = new Map<number, Float32Array | null>();
  private latest: number | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshTimer?: NodeJS.Timeout;
  private firstRunTimer?: NodeJS.Timeout;

  constructor(private readonly config: AppConfigService) {}

  onApplicationBootstrap(): void {
    if (!this.baseUrl) return;
    this.firstRunTimer = setTimeout(() => this.refreshInBackground(), FIRST_RUN_DELAY_MS);
    this.refreshTimer = setInterval(() => this.refreshInBackground(), REFRESH_MS);
  }

  onModuleDestroy(): void {
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

  /** Busca la imagen más reciente y baja las que falten, de la más nueva a la más vieja. */
  async refresh(now = Date.now()): Promise<void> {
    const latest = await this.findLatest(now);
    if (latest === null) {
      this.logger.warn('PARDIG no tiene imágenes recientes');
      return;
    }
    this.latest = latest;
    const oldest = Math.floor(latest / HOUR_MS) * HOUR_MS - KEEP_HOURS * HOUR_MS + FRAME_MS;
    for (const time of this.frames.keys()) if (time < oldest) this.frames.delete(time);

    const wanted: number[] = [];
    for (let time = latest; time >= oldest; time -= FRAME_MS) if (!this.frames.has(time)) wanted.push(time);
    if (wanted.length === 0) return;
    let failed = 0;
    await mapWithConcurrency(wanted, DOWNLOAD_CONCURRENCY, async (time) => {
      try {
        this.frames.set(time, await this.download(time));
      } catch {
        // Queda sin cargar: se vuelve a intentar en la próxima actualización.
        failed += 1;
      }
    });
    this.logger.log(`PARDIG: ${wanted.length - failed} imágenes nuevas hasta ${new Date(latest).toISOString()}${failed ? `, ${failed} sin bajar` : ''}`);
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
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 404) return null;
    if (!response.ok) throw new UpstreamError(SERVICE, `respondió HTTP ${response.status}`, response.status);
    return cropFrame(await decompress(Buffer.from(await response.arrayBuffer())));
  }
}
