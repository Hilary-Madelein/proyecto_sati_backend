import type { RasterGrid } from '../../common/raster/raster-grid.js';

/*
 * PARDIG (Google DeepMind): lluvia estimada con IA a partir de satélites, cada 15
 * minutos, en una grilla mundial de 0,1° (1801 × 3600). Cada dato es la intensidad
 * de la lluvia en ese instante, en metros por hora. De cada imagen solo se guarda
 * el recorte del Ecuador continental, en memoria.
 */

/** Grilla mundial: centros de celda cada 0,1°, latitud de -90 a 90 (sur a norte) y longitud de 0 a 359,9. */
const WORLD = { width: 3600, height: 1801, step: 0.1 } as const;

/** Centros de celda del recorte (Ecuador continental, como el satélite del INAMHI), en décimas de grado. */
const CROP = { westTenths: -812, eastTenths: -751, southTenths: -51, northTenths: 16 } as const;

export const CROP_WIDTH = CROP.eastTenths - CROP.westTenths + 1;
export const CROP_HEIGHT = CROP.northTenths - CROP.southTenths + 1;
/** [oeste, sur, este, norte]: borde exterior de las celdas del recorte. */
export const CROP_BBOX: [number, number, number, number] = [
  (CROP.westTenths - 0.5) / 10,
  (CROP.southTenths - 0.5) / 10,
  (CROP.eastTenths + 0.5) / 10,
  (CROP.northTenths + 0.5) / 10,
];

export const FRAME_MS = 15 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
/** Imágenes de una hora: las de los minutos 15, 30, 45 y 60. */
const FRAMES_PER_HOUR = HOUR_MS / FRAME_MS;
/** Con menos imágenes, la hora no se calcula. */
const MIN_FRAMES_PER_HOUR = 3;
const M_TO_MM = 1000;

/** "20261113T163000": así se llama la carpeta de cada imagen (hora UTC del dato). */
export function frameFolder(time: number): string {
  return new Date(time).toISOString().replace(/[-:]/g, '').slice(0, 15);
}

/**
 * Recorta el Ecuador de una imagen mundial ya descomprimida (float32, little-endian,
 * de sur a norte). Devuelve la intensidad en mm/h, con la fila 0 al norte.
 */
export function cropFrame(world: Buffer): Float32Array {
  if (world.length !== WORLD.width * WORLD.height * 4) {
    throw new Error(`la imagen de PARDIG no tiene el tamaño esperado (${world.length} bytes)`);
  }
  const crop = new Float32Array(CROP_WIDTH * CROP_HEIGHT);
  for (let row = 0; row < CROP_HEIGHT; row++) {
    const worldRow = CROP.northTenths - row + 900;
    for (let column = 0; column < CROP_WIDTH; column++) {
      // Longitudes al oeste de Greenwich: 360 + longitud.
      const worldColumn = CROP.westTenths + column + WORLD.width;
      const value = world.readFloatLE((worldRow * WORLD.width + worldColumn) * 4);
      crop[row * CROP_WIDTH + column] = Number.isFinite(value) && value >= 0 ? value * M_TO_MM : Number.NaN;
    }
  }
  return crop;
}

/** Horas de las cuatro imágenes de la hora que termina en `hourEnd`. */
export function framesOfHour(hourEnd: number): number[] {
  return Array.from({ length: FRAMES_PER_HOUR }, (_, index) => hourEnd - (FRAMES_PER_HOUR - 1 - index) * FRAME_MS);
}

/**
 * Lluvia (mm) de una hora: el promedio de la intensidad de sus imágenes (mm/h)
 * durante esa hora. Null si faltan demasiadas imágenes.
 */
export function hourlyGrid(frames: readonly (Float32Array | null | undefined)[]): RasterGrid | null {
  const loaded = frames.filter((frame): frame is Float32Array => frame instanceof Float32Array);
  if (loaded.length < MIN_FRAMES_PER_HOUR) return null;
  const values = new Float64Array(CROP_WIDTH * CROP_HEIGHT);
  for (let index = 0; index < values.length; index++) {
    let total = 0;
    for (const frame of loaded) total += frame[index];
    values[index] = total / loaded.length;
  }
  return { width: CROP_WIDTH, height: CROP_HEIGHT, bbox: CROP_BBOX, values, noData: null };
}
