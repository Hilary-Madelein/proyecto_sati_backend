import { Blosc } from 'numcodecs';
import { z } from 'zod';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';

const SERVICE = 'GEOGLOWS (archivo AWS)';
const HOUR_MS = 60 * 60 * 1000;
const blosc = Blosc.fromConfig({ id: 'blosc', clevel: 5, cname: 'lz4', shuffle: 1, blocksize: 0 });

type TypedArray = Int32Array | Float32Array | Float64Array | BigInt64Array;

const zarraySchema = z.looseObject({
  shape: z.array(z.number().int().nonnegative()),
  chunks: z.array(z.number().int().positive()),
  dtype: z.string(),
});
type ZarrArray = z.infer<typeof zarraySchema>;

interface RunMetadata {
  qout: ZarrArray;
  rivid: ZarrArray;
  time: ZarrArray;
  /** "seconds since 2026-10-01" */
  timeUnits: string;
}

/** Bytes de un bloque Zarr (blosc) → arreglo según su tipo. Solo los tipos que usa el archivo de GEOGLOWS. */
async function decodeChunk(bytes: Uint8Array, dtype: string): Promise<TypedArray> {
  const raw = await blosc.decode(bytes);
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  switch (dtype) {
    case '<i4':
      return new Int32Array(buffer);
    case '<i8':
      return new BigInt64Array(buffer);
    case '<f4':
      return new Float32Array(buffer);
    case '<f8':
      return new Float64Array(buffer);
    default:
      throw new UpstreamError(SERVICE, `tipo de dato no soportado: ${dtype}`);
  }
}

/** "seconds since 2026-10-01" (o "…2026-10-01 00:00:00") → milisegundos de esa fecha base. */
export function timeBaseMs(units: string): number {
  const match = /^seconds since (\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(units.trim());
  if (!match) throw new UpstreamError(SERVICE, `unidad de tiempo inesperada: ${units}`);
  return Date.parse(`${match[1]}T${match[2] ?? '00:00:00'}Z`);
}

/**
 * Lector del archivo de pronósticos de GEOGLOWS v2 en AWS (un Zarr por corrida,
 * desde julio de 2024). `Qout` es [52 miembros × 280 pasos × 6,8 M ríos] y se
 * guarda en bloques de 686 ríos: leer un río descarga su bloque entero
 * (10–16 MB, decenas de segundos). El orden de los ríos (`rivid`) es el mismo
 * en todas las corridas, así que la posición de cada río se calcula una vez.
 */
export class ForecastZarrArchive {
  /** Ids de todos los ríos (~27 MB): solo se descargan para ubicar un río nuevo. */
  private readonly riverIds = new TtlCache<Int32Array>(HOUR_MS, 1);
  private readonly positions = new Map<number, number | null>();
  private readonly metadata = new TtlCache<RunMetadata>(24 * HOUR_MS, 50);
  /** Lo leído de cada río y corrida: estadísticas y miembros usan el mismo bloque de ~15 MB. */
  private readonly series = new TtlCache<{ times: string[]; members: Array<Array<number | null>> }>(24 * HOUR_MS, 30);

  constructor(private readonly baseUrl: string) {}

  /** Los 52 miembros de un río en una corrida (AAAAMMDD), con sus horas. */
  members(riverId: number, run: string): Promise<{ times: string[]; members: Array<Array<number | null>> }> {
    return this.series.get(`${riverId}:${run}`, () => this.readMembers(riverId, run));
  }

  private async readMembers(riverId: number, run: string): Promise<{ times: string[]; members: Array<Array<number | null>> }> {
    const meta = await this.runMetadata(run);
    const [memberCount, steps, rivers] = meta.qout.shape;
    const [chunkMembers, chunkSteps, chunkRivers] = meta.qout.chunks;
    if (chunkMembers !== memberCount || chunkSteps !== steps) {
      throw new UpstreamError(SERVICE, 'la organización del archivo cambió (bloques de Qout inesperados)');
    }

    const position = await this.position(riverId, run, rivers);
    if (position === null) throw new UpstreamError(SERVICE, `el río ${riverId} no está en el archivo`, 404);

    const [times, qout] = await Promise.all([
      this.chunk(run, 'time/0', meta.time.dtype),
      this.chunk(run, `Qout/0.0.${Math.floor(position / chunkRivers)}`, meta.qout.dtype, 180_000),
    ]);
    const base = timeBaseMs(meta.timeUnits);
    const column = position % chunkRivers;
    const flow = (member: number, step: number) => {
      const value = Number(qout[(member * steps + step) * chunkRivers + column]);
      // Float32 trae decimales de más: se redondea a milésimas, como las estadísticas.
      return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
    };

    return {
      times: Array.from({ length: steps }, (_, step) => new Date(base + Number(times[step]) * 1000).toISOString()),
      members: Array.from({ length: memberCount }, (_, member) => Array.from({ length: steps }, (_, step) => flow(member, step))),
    };
  }

  private async position(riverId: number, run: string, rivers: number): Promise<number | null> {
    const known = this.positions.get(riverId);
    if (known !== undefined) return known;
    const ids = await this.riverIds.get('all', () => this.loadRiverIds(run, rivers));
    const index = ids.indexOf(riverId);
    if (this.positions.size >= 10_000) this.positions.clear();
    this.positions.set(riverId, index >= 0 ? index : null);
    return index >= 0 ? index : null;
  }

  private async loadRiverIds(run: string, rivers: number): Promise<Int32Array> {
    const { rivid } = await this.runMetadata(run);
    const chunkCount = Math.ceil(rivers / rivid.chunks[0]);
    const chunks = await Promise.all(Array.from({ length: chunkCount }, (_, index) => this.chunk(run, `rivid/${index}`, rivid.dtype)));
    const ids = new Int32Array(rivers);
    chunks.forEach((chunk, index) => {
      const start = index * rivid.chunks[0];
      // El último bloque viene completo (relleno): se recorta al total de ríos.
      ids.set(Array.from(chunk.slice(0, Math.min(chunk.length, rivers - start)), Number), start);
    });
    return ids;
  }

  private runMetadata(run: string): Promise<RunMetadata> {
    return this.metadata.get(run, async () => {
      const response = await fetchWithRetry(`${this.runUrl(run)}/.zmetadata`, { service: SERVICE, timeoutMs: 30_000 });
      const { metadata } = (await response.json()) as { metadata: Record<string, Record<string, unknown>> };
      const array = (name: string) => {
        const zarray = zarraySchema.safeParse(metadata[`${name}/.zarray`]);
        if (!zarray.success) throw new UpstreamError(SERVICE, `al archivo de la corrida le falta "${name}" o cambió su formato`);
        return zarray.data;
      };
      return {
        qout: array('Qout'),
        rivid: array('rivid'),
        time: array('time'),
        timeUnits: String(metadata['time/.zattrs']?.units ?? ''),
      };
    });
  }

  private async chunk(run: string, key: string, dtype: string, timeoutMs = 60_000): Promise<TypedArray> {
    const response = await fetchWithRetry(`${this.runUrl(run)}/${key}`, { service: SERVICE, timeoutMs, retries: 1 });
    return decodeChunk(new Uint8Array(await response.arrayBuffer()), dtype);
  }

  private runUrl(run: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/${run}00.zarr`;
  }
}

/** Carpetas del listado S3 ("2024070100.zarr/") → fechas AAAAMMDD, y el token para seguir paginando. */
export function parseS3Listing(xml: string): { dates: string[]; nextToken: string | null } {
  const dates = [...xml.matchAll(/<Prefix>(\d{8})00\.zarr\/<\/Prefix>/g)].map((match) => match[1]);
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
  return { dates, nextToken: truncated ? token : null };
}
