import { PNG } from 'pngjs';
import { createColorRamp } from './color-ramp.js';
import { fillGaps, gridMax, sumGrids, valueAt, type RasterGrid } from './raster-grid.js';
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

describe('valueAt', () => {
  // bbox [-80, -2, -78, 0]: fila 0 = norte; cada celda de 1° × 1°.
  const g = grid([1, 2, 3, -9999], -9999);

  it('devuelve la celda que contiene el punto', () => {
    expect(valueAt(g, -0.5, -79.5)).toBe(1);
    expect(valueAt(g, -0.5, -78.5)).toBe(2);
    expect(valueAt(g, -1.5, -79.5)).toBe(3);
  });

  it('devuelve null sin dato o fuera de la grilla', () => {
    expect(valueAt(g, -1.5, -78.5)).toBeNull();
    expect(valueAt(g, 1, -79)).toBeNull();
    expect(valueAt(g, -1, -70)).toBeNull();
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
    const png = PNG.sync.read(renderGridPng(grid([5, 5, 5, 5]), () => [10, 20, 30, 255], { scale: 3 }));
    expect([png.width, png.height]).toEqual([6, 6]);
    expect(Array.from(png.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });

  /** Valor pintado en cada píxel de la primera fila (el color lleva el valor en el canal rojo). */
  const firstRow = (buffer: Buffer) => {
    const png = PNG.sync.read(buffer);
    return Array.from({ length: png.width }, (_, col) => (png.data[col * 4 + 3] === 0 ? null : png.data[col * 4]));
  };
  const asRed = (value: number): [number, number, number, number] => [Math.round(value), 0, 0, 255];

  it('sin suavizar repite el valor de la celda; suavizado, interpola entre centros', () => {
    const values = grid([0, 100, 0, 100]);
    expect(firstRow(renderGridPng(values, asRed, { scale: 4 }))).toEqual([0, 0, 0, 0, 100, 100, 100, 100]);

    const smooth = firstRow(renderGridPng(values, asRed, { scale: 4, smooth: true }));
    expect(smooth[0]).toBe(0);
    expect(smooth.at(-1)).toBe(100);
    // Entre los dos centros hay valores intermedios crecientes.
    expect(smooth.slice(2, 6)).toEqual(smooth.slice(2, 6).sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(smooth.some((value) => value !== null && value > 0 && value < 100)).toBe(true);
  });

  it('no mezcla con celdas sin dato al suavizar', () => {
    const row = firstRow(renderGridPng(grid([50, -9999, 50, -9999], -9999), asRed, { scale: 4, smooth: true }));
    expect(row).toEqual([50, 50, 50, 50, null, null, null, null]);
  });

  it('deja transparente lo que queda fuera del recorte', () => {
    // Recorte: solo la mitad oeste de la grilla (-80 a -79).
    const clip = [
      [
        [-80, -2],
        [-79, -2],
        [-79, 0],
        [-80, 0],
      ] as const,
    ];
    const row = firstRow(renderGridPng(grid([7, 7, 7, 7]), asRed, { scale: 4, clip }));
    expect(row).toEqual([7, 7, 7, 7, null, null, null, null]);
  });

  it('deja transparente lo que cae dentro de los anillos excluidos (p. ej. la tierra)', () => {
    const land = [
      [
        [-79, -2],
        [-78, -2],
        [-78, 0],
        [-79, 0],
      ] as const,
    ];
    const row = firstRow(renderGridPng(grid([7, 7, 7, 7]), asRed, { scale: 4, exclude: land }));
    expect(row).toEqual([7, 7, 7, 7, null, null, null, null]);
  });
});

describe('fillGaps', () => {
  it('cada celda vacía junto a datos toma el promedio de sus vecinas, una franja por pasada', () => {
    const strip: RasterGrid = { width: 4, height: 1, bbox: [-80, -1, -76, 0], values: Float64Array.from([2, 4, NaN, NaN]), noData: null };
    expect(Array.from(fillGaps(strip, 1).values)).toEqual([2, 4, 4, NaN]);
    expect(Array.from(fillGaps(strip, 2).values)).toEqual([2, 4, 4, 4]);
  });

  it('trata el valor de "sin dato" como vacío y no modifica la grilla original', () => {
    const original = grid([10, -9999, 20, 30], -9999);
    const filled = fillGaps(original, 1);
    expect(filled.values[1]).toBe(20);
    expect(filled.noData).toBeNull();
    expect(original.values[1]).toBe(-9999);
  });
});
