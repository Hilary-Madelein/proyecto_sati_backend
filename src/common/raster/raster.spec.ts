import { PNG } from 'pngjs';
import { createColorRamp } from './color-ramp.js';
import { gridMax, sumGrids, type RasterGrid } from './raster-grid.js';
import { renderGridPng } from './render-png.js';

const grid = (values: number[], noData: number | null = null): RasterGrid => ({
  width: 2,
  height: 2,
  bbox: [-80, -2, -78, 0],
  values: Float64Array.from(values),
  noData,
});

describe('sumGrids', () => {
  it('suma celda a celda y propaga las celdas sin dato', () => {
    const total = sumGrids([grid([1, 2, 3, -9999], -9999), grid([10, 20, 30, 40])]);
    expect(Array.from(total.values.slice(0, 3))).toEqual([11, 22, 33]);
    expect(Number.isNaN(total.values[3])).toBe(true);
    expect(gridMax(total)).toBe(33);
  });
});

describe('createColorRamp', () => {
  const ramp = createColorRamp([
    { value: 1, color: '#000000', opacity: 0 },
    { value: 2, color: '#0000ff', opacity: 1 },
    { value: 4, color: '#ff0000', opacity: 1 },
  ]);

  it('es transparente bajo la primera parada e interpola entre paradas', () => {
    expect(ramp(0.5)[3]).toBe(0);
    expect(ramp(3)).toEqual([128, 0, 128, 255]);
  });

  it('usa el último color por encima de la última parada', () => {
    expect(ramp(100)).toEqual([255, 0, 0, 255]);
  });
});

describe('renderGridPng', () => {
  it('genera un PNG del tamaño de la grilla por la escala', () => {
    const png = PNG.sync.read(renderGridPng(grid([5, 5, 5, 5]), () => [10, 20, 30, 255], 3));
    expect([png.width, png.height]).toEqual([6, 6]);
    expect(Array.from(png.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });
});
