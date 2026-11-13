import { describe, expect, it } from 'vitest';
import { CROP_BBOX, CROP_HEIGHT, CROP_WIDTH, FRAME_MS, cropFrame, frameFolder, framesOfHour, hourlyGrid } from './pardig-grid.js';

const WORLD_WIDTH = 3600;
const WORLD_HEIGHT = 1801;

/** Imagen mundial con un valor (m/h) en la celda de una latitud y longitud dadas. */
function worldWith(cells: Array<{ lat: number; lng: number; metersPerHour: number }>): Buffer {
  const world = Buffer.alloc(WORLD_WIDTH * WORLD_HEIGHT * 4);
  for (const { lat, lng, metersPerHour } of cells) {
    const row = Math.round((lat + 90) * 10);
    const column = Math.round(((lng + 360) % 360) * 10);
    world.writeFloatLE(metersPerHour, (row * WORLD_WIDTH + column) * 4);
  }
  return world;
}

describe('recorte de PARDIG', () => {
  it('el recorte cubre el Ecuador continental en celdas de 0,1°', () => {
    expect([CROP_WIDTH, CROP_HEIGHT]).toEqual([62, 68]);
    expect(CROP_BBOX).toEqual([-81.25, -5.15, -75.05, 1.65]);
  });

  it('la carpeta de cada imagen lleva su hora UTC', () => {
    expect(frameFolder(Date.parse('2026-11-13T16:30:00Z'))).toBe('20261113T163000');
  });

  it('ubica cada celda en su lugar (norte arriba) y pasa de m/h a mm/h', () => {
    // Guayaquil (-2,2; -79,9) con 0,012 m/h = 12 mm/h; una celda fuera del recorte no entra.
    const crop = cropFrame(worldWith([{ lat: -2.2, lng: -79.9, metersPerHour: 0.012 }, { lat: 10, lng: -79.9, metersPerHour: 0.5 }]));
    const row = Math.round((1.6 - -2.2) * 10);
    const column = Math.round((-79.9 - -81.2) * 10);
    expect(crop[row * CROP_WIDTH + column]).toBeCloseTo(12, 4);
    expect(crop.reduce((sum, value) => sum + value, 0)).toBeCloseTo(12, 4);
  });

  it('rechaza una imagen de otro tamaño', () => {
    expect(() => cropFrame(Buffer.alloc(100))).toThrow('tamaño esperado');
  });
});

describe('lluvia de una hora', () => {
  const frame = (mmPerHour: number) => new Float32Array(CROP_WIDTH * CROP_HEIGHT).fill(mmPerHour);

  it('una hora son las imágenes de los minutos 15, 30, 45 y 60', () => {
    const end = Date.parse('2026-11-13T17:00:00Z');
    expect(framesOfHour(end)).toEqual([end - 3 * FRAME_MS, end - 2 * FRAME_MS, end - FRAME_MS, end]);
  });

  it('es el promedio de la intensidad de sus imágenes', () => {
    const grid = hourlyGrid([frame(4), frame(8), frame(0), frame(12)]);
    expect(grid?.values[0]).toBe(6);
    expect(grid).toMatchObject({ width: CROP_WIDTH, height: CROP_HEIGHT, bbox: CROP_BBOX });
  });

  it('tolera una imagen que falta, pero no dos', () => {
    expect(hourlyGrid([frame(3), null, frame(6), frame(9)])?.values[0]).toBe(6);
    expect(hourlyGrid([frame(3), null, undefined, frame(9)])).toBeNull();
  });
});
