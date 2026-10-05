import { PNG } from 'pngjs';
import { crossingsAtLatitude, isInsideCrossings, type Ring } from '../geo/polygon.js';
import type { Rgba } from './color-ramp.js';
import type { RasterGrid } from './raster-grid.js';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + toRadians(lat) / 2));
const latFromMercatorY = (y: number) => toDegrees(2 * Math.atan(Math.exp(y)) - Math.PI / 2);
const TRANSPARENT: Rgba = [0, 0, 0, 0];

export interface RenderOptions {
  /** Cuántos píxeles por celda en cada eje. Por defecto 3. */
  scale?: number;
  /**
   * Interpola el valor entre los centros de las celdas vecinas (bilineal) en
   * vez de repetir la celda: la imagen se ve suave en lugar de en bloques.
   */
  smooth?: boolean;
  /** Solo se pinta lo que cae dentro de estos anillos (p. ej. el contorno del país). */
  clip?: readonly Ring[];
}

/**
 * Pinta una grilla lat/lon como PNG listo para superponer en un mapa Web
 * Mercator (Leaflet `imageOverlay`): las filas se reubican según Mercator para
 * que cada celda quede donde corresponde.
 */
export function renderGridPng(grid: RasterGrid, color: (value: number) => Rgba, options: RenderOptions = {}): Buffer {
  const { scale = 3, smooth = false, clip } = options;
  const [west, south, east, north] = grid.bbox;
  const width = grid.width * scale;
  const height = grid.height * scale;
  const [yNorth, ySouth] = [mercatorY(north), mercatorY(south)];
  const png = new PNG({ width, height });

  const valid = (value: number) => Number.isFinite(value) && value !== grid.noData;
  const at = (row: number, col: number) => grid.values[row * grid.width + col];
  const clampRow = (row: number) => Math.min(grid.height - 1, Math.max(0, row));
  const clampCol = (col: number) => Math.min(grid.width - 1, Math.max(0, col));

  /** Valor en una posición continua de la grilla (en celdas, 0 = borde norte/oeste). */
  function sample(fy: number, fx: number): number {
    const nearest = at(clampRow(Math.floor(fy)), clampCol(Math.floor(fx)));
    if (!smooth) return nearest;
    // Centros de celda en .5: se interpola entre las cuatro celdas que rodean el punto.
    const y = fy - 0.5;
    const x = fx - 0.5;
    const row0 = clampRow(Math.floor(y));
    const col0 = clampCol(Math.floor(x));
    const row1 = clampRow(row0 + 1);
    const col1 = clampCol(col0 + 1);
    const corners = [at(row0, col0), at(row0, col1), at(row1, col0), at(row1, col1)];
    // En bordes con celdas sin dato se usa la celda más cercana, sin mezclar.
    if (!corners.every(valid)) return nearest;
    const ty = Math.min(1, Math.max(0, y - row0));
    const tx = Math.min(1, Math.max(0, x - col0));
    const top = corners[0] * (1 - tx) + corners[1] * tx;
    const bottom = corners[2] * (1 - tx) + corners[3] * tx;
    return top * (1 - ty) + bottom * ty;
  }

  for (let row = 0; row < height; row++) {
    const lat = latFromMercatorY(yNorth - ((row + 0.5) / height) * (yNorth - ySouth));
    const fy = ((north - lat) / (north - south)) * grid.height;
    const crossings = clip ? crossingsAtLatitude(clip, lat) : null;

    for (let col = 0; col < width; col++) {
      const lng = west + ((col + 0.5) / width) * (east - west);
      const fx = ((lng - west) / (east - west)) * grid.width;
      const inside = !crossings || isInsideCrossings(crossings, lng);
      const value = inside ? sample(fy, fx) : Number.NaN;
      const [r, g, b, a] = valid(value) ? color(value) : TRANSPARENT;

      const offset = (row * width + col) * 4;
      png.data[offset] = r;
      png.data[offset + 1] = g;
      png.data[offset + 2] = b;
      png.data[offset + 3] = a;
    }
  }
  return PNG.sync.write(png);
}
