/**
 * Tipos de evento propios del sistema, independientes de cualquier fuente.
 * Cada integración traduce sus códigos a estos valores.
 */
export const HAZARD_TYPES = {
  /** Inundación sin detalle de su origen (o lacustre). */
  flood: 'Inundación',
  /** Desborde o crecida de un río, estero o quebrada (inundación fluvial). */
  river_flood: 'Desborde de río',
  /** Agua de lluvia acumulada en calles, viviendas o cultivos (inundación pluvial). */
  rain_flood: 'Inundación por lluvia',
  /** Lluvia que no drena por alcantarillado o sumideros tapados. */
  drainage_flood: 'Inundación por drenaje',
  coastal_flood: 'Inundación costera',
  landslide: 'Deslizamiento',
  mudflow: 'Aluvión',
  heavy_rain: 'Lluvias intensas',
  subsidence: 'Hundimiento',
  water_erosion: 'Erosión hídrica',
  rockfall: 'Caídas',
  soil_creep: 'Reptación',
  other: 'Otro',
} as const;

export type HazardType = keyof typeof HAZARD_TYPES;

export const HAZARD_TYPE_VALUES = Object.keys(HAZARD_TYPES) as HazardType[];

/** Inundaciones: lo único que se muestra cuando no se pide un tipo concreto. */
export const FLOOD_HAZARD_TYPES: readonly HazardType[] = ['river_flood', 'rain_flood', 'drainage_flood', 'coastal_flood', 'flood'];

/** Impacto según las cifras de daños: alto, medio o bajo. */
export const IMPACT_LEVELS = ['high', 'medium', 'low'] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export const IMPACT_LEVEL_LABELS: Record<ImpactLevel, string> = { high: 'Alto', medium: 'Medio', low: 'Bajo' };
