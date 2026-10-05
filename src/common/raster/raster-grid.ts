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
