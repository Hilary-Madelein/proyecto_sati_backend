/** Las 24 provincias del Ecuador, con su nombre oficial. */
export const ECUADOR_PROVINCES = [
  'Azuay',
  'Bolívar',
  'Cañar',
  'Carchi',
  'Chimborazo',
  'Cotopaxi',
  'El Oro',
  'Esmeraldas',
  'Galápagos',
  'Guayas',
  'Imbabura',
  'Loja',
  'Los Ríos',
  'Manabí',
  'Morona Santiago',
  'Napo',
  'Orellana',
  'Pastaza',
  'Pichincha',
  'Santa Elena',
  'Santo Domingo de los Tsáchilas',
  'Sucumbíos',
  'Tungurahua',
  'Zamora Chinchipe',
] as const;

export type EcuadorProvince = (typeof ECUADOR_PROVINCES)[number];

/** "LOS RIOS" / "Los Ríos " → "los rios": sin tildes, mayúsculas ni espacios de más. */
export function provinceKey(name: string): string {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const BY_KEY = new Map(ECUADOR_PROVINCES.map((province) => [provinceKey(province), province]));

/** Nombre oficial de una provincia escrita de cualquier forma, o null si no existe. */
export function toOfficialProvince(name: string): EcuadorProvince | null {
  return BY_KEY.get(provinceKey(name)) ?? null;
}
