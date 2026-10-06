import { File as Hdf5File } from 'jsfive';
import { UpstreamError } from '../../common/http/upstream.error.js';
import type { RasterGrid } from '../../common/raster/raster-grid.js';
import type { SeaTemperatureField } from '../../modules/sea-temperature/sea-temperature-source.js';

const SERVICE = 'NOAA OISST';

/**
 * Formato fijo de los archivos diarios de OISST v2.1 (NetCDF-4): enteros de
 * 16 bits con escala 0,01 y -999 como "sin dato" (tierra o hielo). jsfive no
 * lee esos atributos de las variables, por eso van aquí.
 */
const SCALE = 0.01;
const FILL = -999;
/** `time` viene en días desde esta fecha. */
const TIME_ORIGIN_MS = Date.UTC(1978, 0, 1, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Recuadro [oeste, sur, este, norte] en grados, longitudes de -180 a 180. */
export type Box = readonly [number, number, number, number];

/**
 * Archivo diario de OISST (grilla global de 0,25°, latitudes de sur a norte y
 * longitudes de 0 a 360) → temperatura y anomalía del recuadro pedido, con la
 * fila 0 al norte y las celdas sin dato como NaN.
 */
export function parseOisstNetcdf(buffer: ArrayBuffer, box: Box): SeaTemperatureField {
  let file: Hdf5File;
  try {
    file = new Hdf5File(buffer, 'oisst.nc');
  } catch (error) {
    throw new UpstreamError(SERVICE, 'el archivo no es un NetCDF-4 válido', undefined, { cause: error });
  }
  for (const name of ['time', 'lat', 'lon', 'sst', 'anom']) {
    if (!file.keys.includes(name)) throw new UpstreamError(SERVICE, `al archivo le falta la variable "${name}"`);
  }

  const lats = Array.from(file.get('lat').value);
  const lons = Array.from(file.get('lon').value, (lon) => (lon > 180 ? lon - 360 : lon));
  const sstRaw = file.get('sst').value;
  const anomRaw = file.get('anom').value;
  if (sstRaw.length !== lats.length * lons.length || anomRaw.length !== sstRaw.length) {
    throw new UpstreamError(SERVICE, 'la grilla del archivo no tiene el tamaño esperado');
  }

  const [west, south, east, north] = box;
  // Filas de norte a sur; columnas de oeste a este.
  const rows = lats.map((lat, index) => ({ lat, index })).filter(({ lat }) => lat >= south && lat <= north).reverse();
  const cols = lons
    .map((lon, index) => ({ lon, index }))
    .filter(({ lon }) => lon >= west && lon <= east)
    .sort((a, b) => a.lon - b.lon);
  if (rows.length < 2 || cols.length < 2) throw new UpstreamError(SERVICE, 'el recuadro pedido no está en la grilla');

  const sst = new Float64Array(rows.length * cols.length);
  const anomaly = new Float64Array(sst.length);
  const read = (raw: number) => (raw === FILL ? Number.NaN : raw * SCALE);
  rows.forEach((row, r) =>
    cols.forEach((col, c) => {
      const source = row.index * lons.length + col.index;
      sst[r * cols.length + c] = read(sstRaw[source]);
      anomaly[r * cols.length + c] = read(anomRaw[source]);
    }),
  );
  assertPlausible(sst);

  // Las coordenadas son centros de celda; el borde exterior queda media celda más allá.
  const half = (cols[1].lon - cols[0].lon) / 2;
  const base = {
    width: cols.length,
    height: rows.length,
    bbox: [cols[0].lon - half, rows.at(-1)!.lat - half, cols.at(-1)!.lon + half, rows[0].lat + half],
    noData: null,
  } satisfies Omit<RasterGrid, 'values'>;

  const days = file.get('time').value[0];
  if (!Number.isFinite(days)) throw new UpstreamError(SERVICE, 'fecha del dato inválida');
  return {
    time: new Date(TIME_ORIGIN_MS + days * DAY_MS).toISOString(),
    sst: { ...base, values: sst },
    anomaly: { ...base, values: anomaly },
  };
}

/** Si la escala cambiara, las temperaturas saldrían absurdas: mejor fallar que pintar datos falsos. */
function assertPlausible(sst: Float64Array): void {
  const valid = sst.filter(Number.isFinite);
  if (valid.length === 0) throw new UpstreamError(SERVICE, 'el recuadro no tiene datos de mar');
  if (valid.some((value) => value < -3 || value > 40)) {
    throw new UpstreamError(SERVICE, 'temperaturas fuera de rango: el formato del archivo pudo cambiar');
  }
}

/** Nombre de archivo diario: final ("…20261005.nc") o preliminar ("…20261005_preliminary.nc"). */
const FILE_PATTERN = /oisst-avhrr-v02r01\.(\d{8})(_preliminary)?\.nc/g;

/**
 * Del listado HTML de una carpeta mensual, el archivo del día más reciente.
 * Si un día tiene versión final y preliminar, se prefiere la final.
 */
export function latestOisstFile(html: string): string | null {
  let best: { date: string; final: boolean; name: string } | null = null;
  for (const match of html.matchAll(FILE_PATTERN)) {
    const candidate = { date: match[1], final: !match[2], name: match[0] };
    if (!best || candidate.date > best.date || (candidate.date === best.date && candidate.final && !best.final)) {
      best = candidate;
    }
  }
  return best?.name ?? null;
}
