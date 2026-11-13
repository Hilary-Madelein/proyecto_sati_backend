import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isInsideRings } from '../../common/geo/polygon.js';
import { bboxOf, ringsOf } from '../canton-analysis/canton-geometry.js';
import type { ParishPoint } from '../canton-analysis/parishes.js';

/*
 * Cuencas hidrográficas (unidades Pfafstetter de nivel 3 del MAE, las mismas del
 * visor): el agua no sigue los límites de provincias ni cantones, así que el
 * análisis mira también a los vecinos que comparten cuenca.
 */
const BASINS_FILE = join(process.cwd(), 'assets', 'cuencas', 'cuencas-ecuador.geojson');

interface BasinsFile {
  features: Array<{ properties: { nombre: string }; geometry: { type: string; coordinates: unknown } }>;
}

/** La cuenca de cada parroquia (por su código), según dónde cae su punto. Las que caen fuera de toda cuenca no aparecen. */
export async function loadParishBasins(parishes: readonly ParishPoint[]): Promise<Map<string, string>> {
  const { features } = JSON.parse(await readFile(BASINS_FILE, 'utf8')) as BasinsFile;
  const basins = features.map(({ properties, geometry }) => {
    const rings = ringsOf(geometry);
    return { name: properties.nombre, rings, bbox: bboxOf(rings) };
  });
  const result = new Map<string, string>();
  for (const parish of parishes) {
    const basin = basins.find(
      ({ rings, bbox: [west, south, east, north] }) =>
        parish.lng >= west && parish.lng <= east && parish.lat >= south && parish.lat <= north && isInsideRings(rings, parish.lng, parish.lat),
    );
    if (basin) result.set(parish.code, basin.name);
  }
  return result;
}
