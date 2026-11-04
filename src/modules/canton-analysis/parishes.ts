import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { valueAt, type RasterGrid } from '../../common/raster/raster-grid.js';
import { toTitleCase } from '../../common/text/title-case.js';
import {
  classifyRain,
  classifyRainWindow,
  RAIN_BANDS,
  RAIN_WINDOWS,
  SEMAPHORE_RANK,
  type RainCategory,
  type RainWindow,
  type Semaphore,
} from './rain-thresholds.js';

/**
 * Un punto por parroquia donde vive la gente: el centro, ponderado por
 * población, de su zona censal urbana más poblada (INEC, sectores del Censo
 * 2010); sin zona urbana, su sector disperso más denso. Parroquias del CONALI
 * (Organización Territorial Parroquial, abril 2023, sin la zona en estudio de
 * Juval); en 44 ciudades (Quito, Guayaquil, Cuenca…) la cabecera cantonal se
 * divide en sus parroquias urbanas, con código y nombre del INEC (Clasificador
 * Geográfico Estadístico 2025): 1.202 en total. Archivo fijo generado una vez;
 * ahí se lee el pronóstico de cada parroquia.
 */
const PARISHES_FILE = join(process.cwd(), 'assets', 'parroquias', 'parroquias-ecuador.json');

export interface ParishPoint {
  /** Código DPA de 6 dígitos. */
  code: string;
  name: string;
  /** Código DPA del cantón (CONALI 2023). */
  cantonCode: string;
  canton: string;
  province: string;
  /** Cabecera cantonal (la ciudad como una unidad), parroquia rural o parroquia urbana (ciudades divididas). */
  kind: 'cabecera' | 'rural' | 'urbana';
  lat: number;
  lng: number;
}

interface ParishesFile {
  parishes: ParishPoint[];
}

export async function loadParishes(): Promise<ParishPoint[]> {
  const { parishes } = JSON.parse(await readFile(PARISHES_FILE, 'utf8')) as ParishesFile;
  return parishes.map((parish) => ({
    ...parish,
    name: toTitleCase(parish.name),
    canton: toTitleCase(parish.canton),
    province: toTitleCase(parish.province),
  }));
}

/** Lluvia pronosticada en el punto de una parroquia y su nivel de alerta (consecuencias y acciones: en la tabla `bands`). */
export interface ParishRain {
  semaphore: Semaphore;
  category: RainCategory;
  categoryLabel: string;
  /** Lluvia de cada ventana en la celda del WRF donde cae el punto, tal cual, y su categoría. */
  forecast: Record<`mm${RainWindow}`, number | null> & Record<`category${RainWindow}`, RainCategory | null>;
  /** Ventana que decidió el nivel (S = el más alto de todas); null si no hay pronóstico en el punto. */
  decidedBy: RainWindow | null;
}

/**
 * Orden de la lista: primero el nivel más alto y, dentro de él, lo que ocurre antes
 * (la ventana que decidió, de 3 a 24 h). A igual ventana, la categoría y la lluvia.
 */
export function byAlertPriority(a: ParishRain, b: ParishRain): number {
  const windowRank = ({ decidedBy }: ParishRain) => (decidedBy ? RAIN_WINDOWS.indexOf(decidedBy) : RAIN_WINDOWS.length);
  const categoryRank = ({ category }: ParishRain) => RAIN_BANDS.findIndex((band) => band.category === category);
  const decisive = ({ decidedBy, forecast }: ParishRain) => (decidedBy ? forecast[`mm${decidedBy}`] : null) ?? -1;
  return (
    SEMAPHORE_RANK[b.semaphore] - SEMAPHORE_RANK[a.semaphore] ||
    windowRank(a) - windowRank(b) ||
    categoryRank(b) - categoryRank(a) ||
    decisive(b) - decisive(a)
  );
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Valor de la celda que contiene el punto, sin promedios ni percentiles; null fuera de la grilla o sin dato. */
function pointMm(grid: RasterGrid | null, lat: number, lng: number): number | null {
  const value = grid ? valueAt(grid, lat, lng) : null;
  return value !== null && value >= 0 ? round1(value) : null;
}

/** Nivel de alerta de una parroquia con el pronóstico de cada ventana en su punto (umbrales del documento). */
export function parishRain(point: { lat: number; lng: number }, grids: Partial<Record<RainWindow, RasterGrid | null>>): ParishRain {
  const mm = Object.fromEntries(RAIN_WINDOWS.map((window) => [window, pointMm(grids[window] ?? null, point.lat, point.lng)])) as Record<RainWindow, number | null>;
  const classified = classifyRain(mm);
  const band = classified?.band ?? RAIN_BANDS[0];
  const categoryOf = (window: RainWindow) => {
    const value = mm[window];
    return value === null ? null : classifyRainWindow(value, window).category;
  };
  return {
    semaphore: band.semaphore,
    category: band.category,
    categoryLabel: band.label,
    forecast: {
      mm3h: mm['3h'],
      mm6h: mm['6h'],
      mm12h: mm['12h'],
      mm24h: mm['24h'],
      category3h: categoryOf('3h'),
      category6h: categoryOf('6h'),
      category12h: categoryOf('12h'),
      category24h: categoryOf('24h'),
    },
    decidedBy: classified?.decidedBy ?? null,
  };
}
