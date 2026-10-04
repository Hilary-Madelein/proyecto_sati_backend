/**
 * Tipos de evento propios del sistema, independientes de cualquier fuente.
 * Cada integración traduce sus códigos a estos valores.
 */
export const HAZARD_TYPES = {
  flood: 'Inundación',
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
