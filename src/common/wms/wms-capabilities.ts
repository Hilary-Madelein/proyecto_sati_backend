import { XMLParser } from 'fast-xml-parser';

export interface WmsLayerDimensions {
  /** Pasos de tiempo disponibles (ISO 8601), ordenados de más antiguo a más reciente. */
  times: string[];
  /** Valor por defecto de TIME según el servidor. */
  defaultTime: string | null;
  /** Otras dimensiones (p. ej. INITD = fecha de la corrida del modelo), con su valor por defecto. */
  extra: Record<string, { default: string | null; values: string[] }>;
}

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Estas etiquetas pueden repetirse: siempre como lista para tratarlas igual.
  isArray: (name) => ['Layer', 'Extent', 'Dimension'].includes(name),
});

const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

const textOf = (node: unknown): string =>
  typeof node === 'object' && node !== null ? String((node as XmlNode)['#text'] ?? '') : String(node ?? '');

function splitValues(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Busca en el árbol de capas la primera con ese nombre que declare dimensiones. */
function findLayer(layers: XmlNode[], name: string): XmlNode | null {
  for (const layer of layers) {
    const layerName = textOf(layer.Name).trim();
    const hasDimensions = asArray(layer.Extent).length > 0 || asArray(layer.Dimension).length > 0;
    if ((layerName === name || layerName.endsWith(`:${name}`)) && hasDimensions) return layer;
    const nested = findLayer(asArray(layer.Layer as XmlNode[]), name);
    if (nested) return nested;
  }
  return null;
}

/**
 * Lee de un GetCapabilities WMS (1.1.x o 1.3.0) las dimensiones de una capa.
 * En 1.1.x los valores van en <Extent>; en 1.3.0, en <Dimension>.
 */
export function parseWmsLayerDimensions(xml: string, layerName: string): WmsLayerDimensions | null {
  const document = parser.parse(xml) as XmlNode;
  const root = (document.WMT_MS_Capabilities ?? document.WMS_Capabilities) as XmlNode | undefined;
  const capability = root?.Capability as XmlNode | undefined;
  const layer = findLayer(asArray(capability?.Layer as XmlNode[]), layerName);
  if (!layer) return null;

  const result: WmsLayerDimensions = { times: [], defaultTime: null, extra: {} };
  for (const node of [...asArray(layer.Extent), ...asArray(layer.Dimension)] as XmlNode[]) {
    const name = String(node['@_name'] ?? '').toUpperCase();
    const values = splitValues(textOf(node));
    if (values.length === 0) continue;
    const defaultValue = node['@_default'] ? String(node['@_default']) : null;

    if (name === 'TIME') {
      result.times = values.sort((a, b) => Date.parse(a) - Date.parse(b));
      result.defaultTime = defaultValue;
    } else if (name) {
      result.extra[name] = { default: defaultValue, values };
    }
  }
  return result;
}
