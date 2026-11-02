/**
 * Zonas de planificación del Ecuador (Decreto Ejecutivo 357, 2010, que reformó el
 * 878): agrupan provincias para administrarlas. Las zonas 8 y 9 son cantones, que
 * se restan de sus provincias en las zonas 5 y 2. Se reconocen por el código DPA:
 * los dos primeros dígitos del cantón son su provincia.
 */
export interface PlanningZone {
  number: number;
  /** Provincias que la forman, para mostrarlas. */
  description: string;
  provinceCodes: readonly string[];
  /** Cantones de esas provincias que pertenecen a otra zona. */
  excludedCantons?: readonly string[];
  /** Cantones sueltos (zonas 8 y 9). */
  cantonCodes?: readonly string[];
}

const GUAYAQUIL = '0901';
const DURAN = '0907';
const SAMBORONDON = '0916';
const QUITO = '1701';

export const PLANNING_ZONES: readonly PlanningZone[] = [
  { number: 1, description: 'Carchi, Esmeraldas, Imbabura, Sucumbíos', provinceCodes: ['04', '08', '10', '21'] },
  { number: 2, description: 'Pichincha (sin Quito), Napo, Orellana', provinceCodes: ['17', '15', '22'], excludedCantons: [QUITO] },
  { number: 3, description: 'Chimborazo, Cotopaxi, Pastaza, Tungurahua', provinceCodes: ['06', '05', '16', '18'] },
  { number: 4, description: 'Manabí, Santo Domingo de los Tsáchilas', provinceCodes: ['13', '23'] },
  {
    number: 5,
    description: 'Guayas (sin la Zona 8), Bolívar, Galápagos, Los Ríos, Santa Elena',
    provinceCodes: ['09', '02', '20', '12', '24'],
    excludedCantons: [GUAYAQUIL, DURAN, SAMBORONDON],
  },
  { number: 6, description: 'Azuay, Cañar, Morona Santiago', provinceCodes: ['01', '03', '14'] },
  { number: 7, description: 'El Oro, Loja, Zamora Chinchipe', provinceCodes: ['07', '11', '19'] },
  { number: 8, description: 'Guayaquil, Durán, Samborondón', provinceCodes: [], cantonCodes: [GUAYAQUIL, DURAN, SAMBORONDON] },
  { number: 9, description: 'Distrito Metropolitano de Quito', provinceCodes: [], cantonCodes: [QUITO] },
];

/** Número de la zona a la que pertenece un cantón, o null si no se reconoce su código. */
export function zoneOfCanton(cantonCode: string): number | null {
  const zone = PLANNING_ZONES.find(
    ({ provinceCodes, excludedCantons = [], cantonCodes = [] }) =>
      cantonCodes.includes(cantonCode) || (provinceCodes.includes(cantonCode.slice(0, 2)) && !excludedCantons.includes(cantonCode)),
  );
  return zone?.number ?? null;
}
