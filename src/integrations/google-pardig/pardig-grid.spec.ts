import { describe, expect, it } from 'vitest';
import { isInsideRings } from '../../common/geo/polygon.js';
import { CROP_BBOX, CROP_END_BYTE, CROP_HEIGHT, CROP_WIDTH, FRAME_MS, FrameCropper, PARDIG_CLIP, WORLD_BYTES, frameFolder, framesOfHour, hourlyGrid } from './pardig-grid.js';

const WORLD_WIDTH = 3600;

/** Imagen mundial con un valor (m/h) en la celda de una latitud y longitud dadas. */
function worldWith(cells: Array<{ lat: number; lng: number; metersPerHour: number }>): Buffer {
  const world = Buffer.alloc(WORLD_BYTES);
  for (const { lat, lng, metersPerHour } of cells) {
    const row = Math.round((lat + 90) * 10);
    const column = Math.round(((lng + 360) % 360) * 10);
    world.writeFloatLE(metersPerHour, (row * WORLD_WIDTH + column) * 4);
  }
  return world;
}

/** Recorta una imagen entregada en pedazos de `size` bytes; devuelve también cuántos bytes hizo falta leer. */
function cropInChunks(world: Buffer, size: number): { crop: Float32Array; read: number } {
  const cropper = new FrameCropper();
  let read = 0;
  while (read < world.length && !cropper.done) {
    cropper.push(world.subarray(read, read + size));
    read = Math.min(world.length, read + size);
  }
  return { crop: cropper.result(), read };
}

describe('recorte de PARDIG', () => {
  // Guayaquil (-2,2; -79,9) con 0,012 m/h = 12 mm/h; las esquinas del recorte; y una celda fuera, que no entra.
  const world = worldWith([
    { lat: -2.2, lng: -79.9, metersPerHour: 0.012 },
    { lat: 1.6, lng: -92.2, metersPerHour: 0.001 },
    { lat: -5.1, lng: -75.1, metersPerHour: 0.002 },
    { lat: 10, lng: -79.9, metersPerHour: 0.5 },
    { lat: -2.2, lng: -60, metersPerHour: 0.5 },
  ]);
  const cell = (lat: number, lng: number) => Math.round((1.6 - lat) * 10) * CROP_WIDTH + Math.round((lng + 92.2) * 10);

  it('el recorte va de Galápagos al oriente del Ecuador en celdas de 0,1°', () => {
    expect([CROP_WIDTH, CROP_HEIGHT]).toEqual([172, 68]);
    expect(CROP_BBOX).toEqual([-92.25, -5.15, -75.05, 1.65]);
  });

  it('se muestra en el continente y en el recuadro de Galápagos, no en el mar entre ambos', () => {
    const inside = (lng: number, lat: number) => isInsideRings(PARDIG_CLIP, lng, lat);
    expect(inside(-79.9, -2.2)).toBe(true); // Guayaquil
    expect(inside(-90.3, -0.74)).toBe(true); // Puerto Ayora
    expect(inside(-89.61, -0.9)).toBe(true); // San Cristóbal
    expect(inside(-85, -1)).toBe(false); // mar abierto
  });

  it('la carpeta de cada imagen lleva su hora UTC', () => {
    expect(frameFolder(Date.parse('2026-11-13T16:30:00Z'))).toBe('20261113T163000');
  });

  it('ubica cada celda en su lugar (norte arriba) y pasa de m/h a mm/h', () => {
    const { crop } = cropInChunks(world, world.length);
    expect(crop[cell(-2.2, -79.9)]).toBeCloseTo(12, 4);
    expect(crop[cell(1.6, -92.2)]).toBeCloseTo(1, 4);
    expect(crop[cell(-5.1, -75.1)]).toBeCloseTo(2, 4);
    expect(crop.reduce((sum, value) => sum + value, 0)).toBeCloseTo(15, 3);
  });

  it('da lo mismo si la imagen llega en pedazos, aunque corten una fila o un número por la mitad', () => {
    const whole = cropInChunks(world, world.length).crop;
    for (const size of [65_536, 16_384, 1_001, 7]) {
      const { crop, read } = cropInChunks(world.subarray(0, CROP_END_BYTE + 50_000), size);
      expect(Array.from(crop)).toEqual(Array.from(whole));
      // Deja de leer al pasar el Ecuador (poco más de la mitad de la imagen), sin llegar al final.
      expect(read).toBeLessThanOrEqual(CROP_END_BYTE + size);
      expect(read).toBeLessThan(WORLD_BYTES * 0.52);
    }
  });

  it('una imagen que llega cortada no se da por buena', () => {
    const cropper = new FrameCropper();
    cropper.push(world.subarray(0, CROP_END_BYTE - 10));
    expect(cropper.done).toBe(false);
    expect(() => cropper.result()).toThrow('incompleta');
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
