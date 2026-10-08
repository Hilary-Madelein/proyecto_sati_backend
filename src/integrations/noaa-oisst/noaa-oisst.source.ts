import { Injectable, Logger } from '@nestjs/common';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { SeaTemperatureSource, type SeaTemperatureField } from '../../modules/sea-temperature/sea-temperature-source.js';
import { latestOisstFile, parseOisstNetcdf } from './oisst-netcdf.js';

const SERVICE = 'NOAA OISST';

/** Recuadro pedido, en grados: mar frente a Ecuador y la región Niño 1+2 (0–10°S, 90–80°O). */
const BBOX = { south: -10, north: 3, west: -90, east: -77 } as const;

/** Parte decimal de las coordenadas de ERDDAP viene con ruido de punto flotante: se agrupa por milésimas. */
const key = (value: number) => Math.round(value * 1000);

/**
 * NOAA OISST v2.1 (casi en tiempo real, ~1 día de retraso): temperatura (`sst`)
 * y anomalía (`anom`) en grilla de 0,25°, ya con la tierra sin dato.
 *
 * 1. Archivo diario oficial de NCEI (NetCDF-4, ~1,5 MB, global): es el origen
 *    del producto y responde desde Ecuador.
 * 2. Si NCEI falla, el mismo dato recortado del ERDDAP de CoastWatch (~100 KB),
 *    que desde algunas redes no responde.
 */
@Injectable()
export class NoaaOisstSource extends SeaTemperatureSource {
  readonly attribution = 'Temperatura del mar: NOAA OISST v2.1';
  private readonly logger = new Logger(NoaaOisstSource.name);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getLatest(): Promise<SeaTemperatureField> {
    try {
      return await this.fromNceiFile();
    } catch (error) {
      this.logger.warn(`NCEI no respondió (${(error as Error).message}); se intenta con ERDDAP`);
      return this.fromErddap();
    }
  }

  /** Último archivo diario: se busca en la carpeta del mes actual y, a inicio de mes, en la del anterior. */
  private async fromNceiFile(): Promise<SeaTemperatureField> {
    const base = this.config.get('OISST_FILES_URL').replace(/\/+$/, '');
    const now = new Date();
    for (const monthsBack of [0, 1]) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
      const folder = `${base}/${month.toISOString().slice(0, 7).replace('-', '')}/`;
      const listing = await (await fetchWithRetry(folder, { service: SERVICE, timeoutMs: 30_000 })).text();
      const name = latestOisstFile(listing);
      if (!name) continue;
      const file = await fetchWithRetry(`${folder}${name}`, { service: SERVICE, timeoutMs: 60_000 });
      return parseOisstNetcdf(await file.arrayBuffer(), [BBOX.west, BBOX.south, BBOX.east, BBOX.north]);
    }
    throw new UpstreamError(SERVICE, 'no hay archivos diarios recientes en NCEI');
  }

  private async fromErddap(): Promise<SeaTemperatureField> {
    // Los corchetes van codificados (%5B, %5D): ERDDAP rechaza los literales.
    const slice = `%5B(last)%5D%5B(0.0)%5D%5B(${BBOX.south}):(${BBOX.north})%5D%5B(${BBOX.west}):(${BBOX.east})%5D`;
    const url = `${this.config.get('OISST_ERDDAP_URL')}.csv?sst${slice},anom${slice}`;
    const csv = await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 60_000 })).text();
    return parseOisstCsv(csv);
  }
}

/** CSV de ERDDAP (dos líneas de encabezado) → temperatura y anomalía en grillas con la fila 0 al norte. */
export function parseOisstCsv(csv: string): SeaTemperatureField {
  const lines = csv.trim().split(/\r?\n/);
  const columns = lines[0]?.split(',') ?? [];
  const [timeCol, latCol, lonCol, sstCol, anomCol] = ['time', 'latitude', 'longitude', 'sst', 'anom'].map((name) =>
    columns.indexOf(name),
  );
  if ([timeCol, latCol, lonCol, sstCol, anomCol].includes(-1) || lines.length < 3) {
    throw new UpstreamError(SERVICE, 'respuesta inesperada (faltan columnas o datos)');
  }

  const rows = lines.slice(2).map((line) => line.split(','));
  const toNumber = (text: string) => (text === '' || text === 'NaN' ? Number.NaN : Number(text));
  const lats = [...new Set(rows.map((row) => key(Number(row[latCol]))))].sort((a, b) => b - a);
  const lons = [...new Set(rows.map((row) => key(Number(row[lonCol]))))].sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) throw new UpstreamError(SERVICE, 'la grilla recibida es demasiado pequeña');

  const latIndex = new Map(lats.map((value, index) => [value, index]));
  const lonIndex = new Map(lons.map((value, index) => [value, index]));
  const sst = new Float64Array(lats.length * lons.length).fill(Number.NaN);
  const anomaly = new Float64Array(sst.length).fill(Number.NaN);
  for (const row of rows) {
    const cell = latIndex.get(key(Number(row[latCol])))! * lons.length + lonIndex.get(key(Number(row[lonCol])))!;
    sst[cell] = toNumber(row[sstCol]);
    anomaly[cell] = toNumber(row[anomCol]);
  }

  // Los centros de celda están en las coordenadas; el borde exterior queda media celda más allá.
  const half = (lons[1] - lons[0]) / 2000;
  const base = {
    width: lons.length,
    height: lats.length,
    bbox: [lons[0] / 1000 - half, lats.at(-1)! / 1000 - half, lons.at(-1)! / 1000 + half, lats[0] / 1000 + half],
    noData: null,
  } satisfies Omit<RasterGrid, 'values'>;

  const time = new Date(rows[0][timeCol]);
  if (Number.isNaN(time.getTime())) throw new UpstreamError(SERVICE, 'fecha del dato inválida');
  return {
    time: time.toISOString(),
    sst: { ...base, values: sst },
    anomaly: { ...base, values: anomaly },
  };
}
