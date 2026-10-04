/** Parámetros WMS que el proxy deja pasar; cualquier otro se ignora. */
const ALLOWED_PARAMS = new Set([
  'VERSION',
  'REQUEST',
  'BBOX',
  'WIDTH',
  'HEIGHT',
  'SRS',
  'CRS',
  'FORMAT',
  'TRANSPARENT',
  'STYLES',
  'TIME',
  'X',
  'Y',
  'I',
  'J',
  'INFO_FORMAT',
  'FEATURE_COUNT',
  'EXCEPTIONS',
  'TILED',
]);

const ALLOWED_REQUESTS = new Set(['GETMAP', 'GETFEATUREINFO', 'GETLEGENDGRAPHIC']);
const MAX_IMAGE_SIZE = 2048;
const MAX_VALUE_LENGTH = 300;

export class WmsRequestError extends Error {}

export interface WmsTarget {
  serviceUrl: string;
  /** Nombre completo de la capa en el servidor, p. ej. "wrf:wrf_precipitation". */
  layerName: string;
  /** Dimensiones extra permitidas para esta capa (p. ej. ["DIM_INITD"]). */
  extraParams?: string[];
}

/**
 * Construye la URL hacia el servidor WMS a partir de la consulta del cliente.
 * La capa y el servidor los fija el backend: el cliente solo elige parámetros
 * de una lista cerrada, así el proxy no sirve para pedir otras capas u otros sitios.
 */
export function buildWmsUrl(target: WmsTarget, query: Record<string, unknown>): URL {
  const url = new URL(target.serviceUrl);
  const allowed = new Set([...ALLOWED_PARAMS, ...(target.extraParams ?? []).map((param) => param.toUpperCase())]);

  for (const [rawKey, rawValue] of Object.entries(query)) {
    const key = rawKey.toUpperCase();
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (!allowed.has(key) || typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) continue;
    url.searchParams.set(key, value);
  }

  const request = url.searchParams.get('REQUEST')?.toUpperCase();
  if (!request || !ALLOWED_REQUESTS.has(request)) {
    throw new WmsRequestError('REQUEST debe ser GetMap, GetFeatureInfo o GetLegendGraphic');
  }

  for (const sizeParam of ['WIDTH', 'HEIGHT']) {
    const size = url.searchParams.get(sizeParam);
    if (size !== null && !(Number(size) > 0 && Number(size) <= MAX_IMAGE_SIZE)) {
      throw new WmsRequestError(`${sizeParam} debe estar entre 1 y ${MAX_IMAGE_SIZE}`);
    }
  }

  url.searchParams.set('SERVICE', 'WMS');
  if (request === 'GETLEGENDGRAPHIC') {
    url.searchParams.set('LAYER', target.layerName);
  } else {
    url.searchParams.set('LAYERS', target.layerName);
    if (request === 'GETFEATUREINFO') url.searchParams.set('QUERY_LAYERS', target.layerName);
  }
  return url;
}
