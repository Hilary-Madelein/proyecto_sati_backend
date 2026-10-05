import { PNG } from 'pngjs';
import type { Rgba } from './color-ramp.js';
import type { RasterGrid } from './raster-grid.js';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + toRadians(lat) / 2));
const latFromMercatorY = (y: number) => toDegrees(2 * Math.atan(Math.exp(y)) - Math.PI / 2);

/**
 * Pinta una grilla lat/lon como PNG listo para superponer en un mapa Web
 * Mercator (Leaflet `imageOverlay`): las filas se reubican según Mercator para
 * que cada celda quede donde corresponde. `scale` agranda la imagen sin
 * suavizar, para que las celdas se vean nítidas.
 */
export function renderGridPng(grid: RasterGrid, color: (value: number) => Rgba, scale = 3): Buffer {
  const [west, south, east, north] = grid.bbox;
  const width = grid.width * scale;
  const height = grid.height * scale;
  const [yNorth, ySouth] = [mercatorY(north), mercatorY(south)];
  const png = new PNG({ width, height });

  for (let row = 0; row < height; row++) {
    const lat = latFromMercatorY(yNorth - ((row + 0.5) / height) * (yNorth - ySouth));
    const sourceRow = Math.min(grid.height - 1, Math.max(0, Math.floor(((north - lat) / (north - south)) * grid.height)));

    for (let col = 0; col < width; col++) {
      const lng = west + ((col + 0.5) / width) * (east - west);
      const sourceCol = Math.min(grid.width - 1, Math.floor(((lng - west) / (east - west)) * grid.width));
      const value = grid.values[sourceRow * grid.width + sourceCol];
      const [r, g, b, a] = value === grid.noData ? [0, 0, 0, 0] : color(value);

      const offset = (row * width + col) * 4;
      png.data[offset] = r;
      png.data[offset + 1] = g;
      png.data[offset + 2] = b;
      png.data[offset + 3] = a;
    }
  }
  return PNG.sync.write(png);
}
