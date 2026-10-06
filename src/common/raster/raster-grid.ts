/** Grilla regular en EPSG:4326 (lat/lon), fila 0 = norte. */
export interface RasterGrid {
  width: number;
  height: number;
  /** [oeste, sur, este, norte] en grados, borde exterior de las celdas. */
  bbox: [number, number, number, number];
  values: Float64Array;
  /** Valor que significa "sin dato", si existe. */
  noData: number | null;
}

/** Suma celda a celda varias grillas con la misma forma. Una celda sin dato en alguna queda sin dato. */
export function sumGrids(grids: RasterGrid[]): RasterGrid {
  const [first, ...rest] = grids;
  if (!first) throw new Error('No hay grillas para sumar');
  for (const grid of rest) {
    if (grid.width !== first.width || grid.height !== first.height) {
      throw new Error('Las grillas no tienen el mismo tamaño');
    }
  }

  const values = new Float64Array(first.values.length);
  for (let index = 0; index < values.length; index++) {
    let total = 0;
    for (const grid of grids) {
      const value = grid.values[index];
      if (!Number.isFinite(value) || value === grid.noData) {
        total = Number.NaN;
        break;
      }
      total += value;
    }
    values[index] = total;
  }
  return { ...first, values, noData: null };
}

/** Mayor valor válido de la grilla (0 si no hay ninguno). */
export function gridMax(grid: RasterGrid): number {
  let max = 0;
  for (const value of grid.values) if (Number.isFinite(value) && value !== grid.noData && value > max) max = value;
  return max;
}

/** Valor de la celda que contiene el punto; null si cae fuera de la grilla o la celda no tiene dato. */
export function valueAt(grid: RasterGrid, lat: number, lng: number): number | null {
  const [west, south, east, north] = grid.bbox;
  if (lng < west || lng >= east || lat <= south || lat > north) return null;
  const column = Math.floor(((lng - west) / (east - west)) * grid.width);
  const row = Math.floor(((north - lat) / (north - south)) * grid.height);
  const value = grid.values[row * grid.width + column];
  return Number.isFinite(value) && value !== grid.noData ? value : null;
}

/**
 * Extiende los datos hacia las celdas vacías vecinas: cada celda sin dato que
 * toca alguna con dato toma el promedio de sus vecinas (8 alrededor), `passes`
 * veces. Sirve para que una imagen recortada a la costa llegue hasta la orilla
 * aunque la grilla marque como tierra las celdas que la tocan.
 */
export function fillGaps(grid: RasterGrid, passes: number): RasterGrid {
  const { width, height } = grid;
  let values = Float64Array.from(grid.values, (value) => (value === grid.noData ? Number.NaN : value));
  for (let pass = 0; pass < passes; pass++) {
    const next = values.slice();
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (Number.isFinite(values[row * width + col])) continue;
        let total = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const [r, c] = [row + dy, col + dx];
            if (r < 0 || r >= height || c < 0 || c >= width) continue;
            const neighbor = values[r * width + c];
            if (Number.isFinite(neighbor)) {
              total += neighbor;
              count++;
            }
          }
        }
        if (count > 0) next[row * width + col] = total / count;
      }
    }
    values = next;
  }
  return { ...grid, values, noData: null };
}
