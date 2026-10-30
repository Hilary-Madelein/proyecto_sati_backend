import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';

const SERVICE = 'ArcGIS';
/** Las capas más grandes (miles de puntos) responden en pocos segundos por página. */
const TIMEOUT_MS = 45_000;

export interface GeoJsonFeature {
  type: 'Feature';
  /** Identificador de la entidad en el servicio (su OBJECTID); con él se piden sus fotos. */
  id?: number | string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
}

export interface ArcgisQueryOptions {
  /** Campos que se piden y se entregan, con su nombre en el servicio. */
  fields: readonly string[];
  /** Filtro SQL del servicio; por defecto todas las filas. */
  where?: string;
  /** Tolerancia de simplificación en grados (líneas y polígonos); sin simplificar si se omite. */
  maxAllowableOffset?: number;
  /** false = solo los datos, sin geometría (mucho más liviano). */
  geometry?: boolean;
  /** true = los campos con lista de valores (dominio) se entregan con su nombre ("01" → "OPERATIVO"). */
  decodeDomains?: boolean;
}

export interface ArcgisLayerData {
  features: GeoJsonFeature[];
  /** Última edición de los datos en el servicio (ISO 8601), si lo informa. */
  lastEditDate: string | null;
  /** Versión de la capa (ver fetchArcgisVersion), con la que se sabe si cambió desde esta descarga. */
  version: number | null;
  /** El servicio guarda archivos adjuntos (fotos) de las entidades. */
  hasAttachments: boolean;
}

/** Foto adjunta a una entidad; la imagen se sirve desde el propio servicio (público). */
export interface ArcgisAttachment {
  id: number;
  name: string;
  url: string;
}

/** Lo que interesa de la descripción de una capa (GET <capa>?f=json). */
interface LayerInfo {
  objectIdField?: string;
  hasAttachments?: boolean;
  maxRecordCount?: number;
  capabilities?: string;
  fields?: Array<{ name: string; type: string; domain?: { codedValues?: Array<{ name: string; code: string | number }> } | null }>;
  editingInfo?: { lastEditDate?: number; dataLastEditDate?: number };
  error?: { message?: string; details?: string[] };
}

interface GeoJsonPage {
  features?: GeoJsonFeature[];
  properties?: { exceededTransferLimit?: boolean };
  exceededTransferLimit?: boolean;
  error?: { message?: string; details?: string[] };
}

/**
 * Descarga todas las entidades de una capa de un FeatureServer de ArcGIS como
 * GeoJSON en WGS84, página por página (cada servicio limita las filas por
 * consulta). Las fechas, que el servicio entrega en milisegundos, se pasan a ISO 8601.
 */
export async function fetchArcgisLayer(layerUrl: string, options: ArcgisQueryOptions): Promise<ArcgisLayerData> {
  const info = await getJson<LayerInfo>(layerUrl, { f: 'json' });
  if (info.error) throw new UpstreamError(SERVICE, `no describe la capa (${errorText(info.error)})`);
  if (!info.capabilities?.split(',').includes('Query')) {
    throw new UpstreamError(SERVICE, 'la capa no permite consultas (solo recibe formularios)');
  }

  const dateFields = new Set(
    (info.fields ?? []).filter((field) => field.type === 'esriFieldTypeDate').map((field) => field.name),
  );
  // Nombre de cada código de los campos con dominio (solo si se pidió).
  const domains = new Map<string, Map<string, string>>();
  if (options.decodeDomains) {
    for (const field of info.fields ?? []) {
      const values = field.domain?.codedValues;
      if (values?.length) domains.set(field.name, new Map(values.map((value) => [String(value.code), value.name])));
    }
  }
  const pageSize = info.maxRecordCount ?? 1000;
  const objectIdField = info.objectIdField ?? 'OBJECTID';
  const params: Record<string, string> = {
    where: options.where ?? '1=1',
    // El identificador va aparte (en `id` de cada entidad), no entre los datos.
    outFields: [...new Set([objectIdField, ...options.fields])].join(','),
    outSR: '4326',
    geometryPrecision: '5',
    orderByFields: objectIdField,
    resultRecordCount: String(pageSize),
    f: 'geojson',
  };
  if (options.maxAllowableOffset) params.maxAllowableOffset = String(options.maxAllowableOffset);
  if (options.geometry === false) params.returnGeometry = 'false';

  const features: GeoJsonFeature[] = [];
  for (let offset = 0; ; ) {
    const page = await getJson<GeoJsonPage>(`${layerUrl}/query`, { ...params, resultOffset: String(offset) });
    if (page.error) throw new UpstreamError(SERVICE, `rechazó la consulta (${errorText(page.error)})`);
    const batch = page.features ?? [];
    for (const feature of batch) features.push(decoded(toFeature(feature, options.fields, dateFields, objectIdField), domains));
    offset += batch.length;
    const exceeded = page.properties?.exceededTransferLimit ?? page.exceededTransferLimit ?? false;
    if (batch.length === 0 || (!exceeded && batch.length < pageSize)) break;
  }

  const edited = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate;
  return {
    features,
    lastEditDate: edited ? new Date(edited).toISOString() : null,
    version: versionOf(info),
    hasAttachments: info.hasAttachments === true,
  };
}

/**
 * Versión actual de la capa: la fecha de su última edición, de datos o de
 * estructura (p. ej. un valor nuevo en una lista). Solo pide la descripción de
 * la capa, así que es mucho más liviano que descargarla. Null si el servicio no
 * la informa.
 */
export async function fetchArcgisVersion(layerUrl: string): Promise<number | null> {
  const info = await getJson<LayerInfo>(layerUrl, { f: 'json' });
  if (info.error) throw new UpstreamError(SERVICE, `no describe la capa (${errorText(info.error)})`);
  return versionOf(info);
}

function versionOf(info: LayerInfo): number | null {
  return info.editingInfo?.lastEditDate ?? info.editingInfo?.dataLastEditDate ?? null;
}

/** La entidad con los códigos de sus campos con dominio cambiados por su nombre. */
function decoded(feature: GeoJsonFeature, domains: ReadonlyMap<string, ReadonlyMap<string, string>>): GeoJsonFeature {
  if (domains.size === 0) return feature;
  const properties = { ...feature.properties };
  for (const [field, names] of domains) {
    const value = properties[field];
    if (value !== null && value !== undefined) properties[field] = names.get(String(value)) ?? value;
  }
  return { ...feature, properties };
}

/** Fotos (adjuntos de tipo imagen) de una entidad, por su OBJECTID. */
export async function fetchArcgisAttachments(layerUrl: string, objectId: number): Promise<ArcgisAttachment[]> {
  const base = `${layerUrl}/${objectId}/attachments`;
  const data = await getJson<{
    attachmentInfos?: Array<{ id: number; name: string; contentType?: string }>;
    error?: { message?: string; details?: string[] };
  }>(base, { f: 'json' });
  if (data.error) throw new UpstreamError(SERVICE, `no entregó los adjuntos (${errorText(data.error)})`);
  return (data.attachmentInfos ?? [])
    .filter((item) => (item.contentType ?? '').startsWith('image/'))
    .map((item) => ({ id: item.id, name: item.name, url: `${base}/${item.id}` }));
}

/** Entidades por consulta de fotos (la lista de ids va en la URL). */
const ATTACHMENTS_BATCH = 200;

/**
 * Fotos de muchas entidades de una capa con pocas consultas (queryAttachments,
 * de a ATTACHMENTS_BATCH entidades), por OBJECTID. Solo imágenes; las entidades
 * sin fotos no aparecen.
 */
export async function fetchArcgisLayerAttachments(layerUrl: string, objectIds: readonly number[]): Promise<Map<number, ArcgisAttachment[]>> {
  const photos = new Map<number, ArcgisAttachment[]>();
  for (let start = 0; start < objectIds.length; start += ATTACHMENTS_BATCH) {
    const data = await getJson<{
      attachmentGroups?: Array<{ parentObjectId: number; attachmentInfos?: Array<{ id: number; name: string; contentType?: string }> }>;
      error?: { message?: string; details?: string[] };
    }>(`${layerUrl}/queryAttachments`, { objectIds: objectIds.slice(start, start + ATTACHMENTS_BATCH).join(','), f: 'json' });
    if (data.error) throw new UpstreamError(SERVICE, `no entregó los adjuntos (${errorText(data.error)})`);
    for (const group of data.attachmentGroups ?? []) {
      const images = (group.attachmentInfos ?? [])
        .filter((item) => (item.contentType ?? '').startsWith('image/'))
        .map((item) => ({ id: item.id, name: item.name, url: `${layerUrl}/${group.parentObjectId}/attachments/${item.id}` }));
      if (images.length > 0) photos.set(group.parentObjectId, images);
    }
  }
  return photos;
}

/** Deja solo los campos pedidos, sin textos vacíos, y con las fechas en ISO 8601. */
export function toFeature(
  feature: GeoJsonFeature,
  fields: readonly string[],
  dateFields: ReadonlySet<string>,
  objectIdField?: string,
): GeoJsonFeature {
  const properties: Record<string, unknown> = {};
  for (const name of fields) {
    let value = feature.properties?.[name];
    if (typeof value === 'string') value = value.trim() || null;
    if (dateFields.has(name) && typeof value === 'number') value = new Date(value).toISOString();
    properties[name] = value ?? null;
  }
  const id = objectIdField ? (feature.properties?.[objectIdField] ?? feature.id) : feature.id;
  return {
    type: 'Feature',
    ...(typeof id === 'number' || typeof id === 'string' ? { id } : {}),
    geometry: feature.geometry,
    properties,
  };
}

async function getJson<T>(url: string, params: Record<string, string>): Promise<T> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return (await (await fetchWithRetry(target, { service: SERVICE, timeoutMs: TIMEOUT_MS, retries: 1 })).json()) as T;
}

function errorText(error: { message?: string; details?: string[] }): string {
  return [error.message, ...(error.details ?? [])].filter(Boolean).join(' ') || 'sin detalle';
}
