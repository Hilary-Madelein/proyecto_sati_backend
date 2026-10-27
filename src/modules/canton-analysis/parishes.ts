import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { valueAt, type RasterGrid } from '../../common/raster/raster-grid.js';
import { toTitleCase } from '../../common/text/title-case.js';
import { classifyRain, classifyRain12h, classifyRain24h, type RainCategory, type RainWindow, type Semaphore } from './rain-thresholds.js';

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
  /** Lluvia de las próximas 12 y 24 h en la celda del WRF donde cae el punto, tal cual, y la categoría de cada ventana. */
  forecast: {
    mm12h: number | null;
    mm24h: number | null;
    category12h: RainCategory | null;
    category24h: RainCategory | null;
  };
  /** Ventana que decidió el nivel (S = máx(S12h, S24h)); null si no hay pronóstico en el punto. */
  decidedBy: RainWindow | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Valor de la celda que contiene el punto, sin promedios ni percentiles; null fuera de la grilla o sin dato. */
function pointMm(grid: RasterGrid | null, lat: number, lng: number): number | null {
  const value = grid ? valueAt(grid, lat, lng) : null;
  return value !== null && value >= 0 ? round1(value) : null;
}

/** Nivel de alerta de una parroquia con el pronóstico de 12 y 24 h en su punto (umbrales del documento). */
export function parishRain(point: { lat: number; lng: number }, grid12h: RasterGrid | null, grid24h: RasterGrid | null): ParishRain {
  const mm12h = pointMm(grid12h, point.lat, point.lng);
  const mm24h = pointMm(grid24h, point.lat, point.lng);
  const classified = classifyRain(mm12h, mm24h);
  const band = classified?.band ?? classifyRain12h(0);
  return {
    semaphore: band.semaphore,
    category: band.category,
    categoryLabel: band.label,
    forecast: {
      mm12h,
      mm24h,
      category12h: mm12h === null ? null : classifyRain12h(mm12h).category,
      category24h: mm24h === null ? null : classifyRain24h(mm24h).category,
    },
    decidedBy: classified?.decidedBy ?? null,
  };
}
