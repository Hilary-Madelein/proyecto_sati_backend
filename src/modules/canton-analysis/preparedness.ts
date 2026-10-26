import type { GeoJsonFeature } from '../../integrations/arcgis/arcgis-feature-layer.js';
import { lineBox } from './canton-geometry.js';

/**
 * Índice Simplificado de Preparación Provincial frente al Fenómeno de El Niño
 * (ISPP-FEN), con la fórmula que envió el equipo el 25/10/2026: cada conteo se
 * divide por el tamaño de la provincia (los alojamientos por su área; campamentos,
 * acciones preventivas y proyectos por los km de Red Vial Estatal que tiene), esa
 * tasa se compara con la provincia de tasa más alta y el índice es la suma
 * ponderada: I = Σ peso × tasa / tasa máx (aquí en 0–100).
 * Mide preparación RELATIVA según los recursos registrados, no suficiencia real.
 */

export type PreparednessIndicator = 'shelters' | 'camps' | 'preventiveActions' | 'roadProjects';

export const PREPAREDNESS_INDICATORS: readonly PreparednessIndicator[] = ['shelters', 'camps', 'preventiveActions', 'roadProjects'];

/** Pesos de cada indicador (suman 1). */
export const PREPAREDNESS_WEIGHTS: Record<PreparednessIndicator, number> = {
  shelters: 0.2,
  camps: 0.2,
  preventiveActions: 0.25,
  roadProjects: 0.35,
};

/** Por qué se divide cada conteo: el área de la provincia (km²) o los km de Red Vial Estatal que la recorren. */
export type PreparednessDenominator = 'area' | 'rve';

export const PREPAREDNESS_DENOMINATORS: Record<PreparednessIndicator, PreparednessDenominator> = {
  shelters: 'area',
  camps: 'rve',
  preventiveActions: 'rve',
  roadProjects: 'rve',
};

/** Semáforo del documento (intervalos propuestos, no oficiales), de menor a mayor. */
export type PreparednessLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';

const LEVELS: ReadonlyArray<{ above: number; level: PreparednessLevel }> = [
  { above: 80, level: 'very-high' },
  { above: 60, level: 'high' },
  { above: 40, level: 'medium' },
  { above: 20, level: 'low' },
];

export interface ProvinceResources {
  /** Código DPA de 2 dígitos. */
  code: string;
  name: string;
  /** Cantidad registrada de cada indicador. */
  counts: Record<PreparednessIndicator, number>;
  /** Área de la provincia, km². */
  areaKm2: number;
  /** Longitud de la Red Vial Estatal en la provincia, km. */
  rveKm: number;
}

export interface ProvincePreparedness extends ProvinceResources {
  /** Cada conteo dividido por su denominador (por km² o por km de vía). */
  rates: Record<PreparednessIndicator, number>;
  /** Tasa de cada indicador frente a la más alta, 0–100. */
  scores: Record<PreparednessIndicator, number>;
  /** ISPP-FEN, 0–100: Σ peso × puntuación. */
  index: number;
  level: PreparednessLevel;
}

/** Nivel del semáforo: 0–20 muy baja, >20–40 baja, >40–60 media, >60–80 alta, >80–100 muy alta. */
export function preparednessLevel(index: number): PreparednessLevel {
  return LEVELS.find((item) => index > item.above)?.level ?? 'very-low';
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Conteo por km² o por km de vía; 0 si la provincia no tiene ese denominador (no divide por cero). */
function rateOf(province: ProvinceResources, indicator: PreparednessIndicator): number {
  const size = PREPAREDNESS_DENOMINATORS[indicator] === 'area' ? province.areaKm2 : province.rveKm;
  return size > 0 ? province.counts[indicator] / size : 0;
}

/** Índice de cada provincia, de la más a la menos preparada. Un indicador sin registros en ninguna provincia vale 0. */
export function preparednessIndex(provinces: readonly ProvinceResources[]): ProvincePreparedness[] {
  const withRates = provinces.map((province) => ({
    ...province,
    rates: Object.fromEntries(PREPAREDNESS_INDICATORS.map((indicator) => [indicator, rateOf(province, indicator)])) as Record<
      PreparednessIndicator,
      number
    >,
  }));
  const max = Object.fromEntries(
    PREPAREDNESS_INDICATORS.map((indicator) => [indicator, Math.max(0, ...withRates.map((province) => province.rates[indicator]))]),
  ) as Record<PreparednessIndicator, number>;
  const relative = (rates: Record<PreparednessIndicator, number>, indicator: PreparednessIndicator) =>
    max[indicator] > 0 ? (rates[indicator] / max[indicator]) * 100 : 0;

  return withRates
    .map((province) => {
      const scores = Object.fromEntries(
        PREPAREDNESS_INDICATORS.map((indicator) => [indicator, round1(relative(province.rates, indicator))]),
      ) as Record<PreparednessIndicator, number>;
      const index = round1(
        PREPAREDNESS_INDICATORS.reduce((sum, indicator) => sum + PREPAREDNESS_WEIGHTS[indicator] * relative(province.rates, indicator), 0),
      );
      return { ...province, areaKm2: round1(province.areaKm2), rveKm: round1(province.rveKm), scores, index, level: preparednessLevel(index) };
    })
    .sort((a, b) => b.index - a.index || a.name.localeCompare(b.name, 'es'));
}

/** Sin tildes, en mayúsculas y con un solo espacio: "El  Oro" y "EL ORO" son lo mismo. */
export function normalizeText(text: unknown): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Código de provincia de un registro según el nombre que trae: exacto, o la única
 * provincia que empieza así ("SANTO DOMINGO" → Santo Domingo de los Tsáchilas).
 * Null si no se reconoce.
 */
export function provinceCodeOf(value: unknown, provincesByName: ReadonlyMap<string, string>): string | null {
  const name = normalizeText(value);
  if (!name) return null;
  const exact = provincesByName.get(name);
  if (exact) return exact;
  const matches = [...provincesByName].filter(([candidate]) => candidate.startsWith(name));
  return matches.length === 1 ? matches[0][1] : null;
}

/** Palabras de obra vial en la descripción de un proyecto. */
const ROAD_WORDS = /CARRETERA|PUENTE|\bVIAS?\b|VIAL|CALZADA|TRAMO|CORREDOR|ASFALT/;
/** Obras en calles y avenidas de una ciudad: son municipales, no de la red vial. */
const URBAN_WORDS = /\bAVENIDAS?\b|\bCALLES?\b/;

/**
 * Si un proyecto de la capa de obras ENOS es vial: unido a un tramo de la Red Vial
 * Estatal, o con una obra vial en su descripción. La capa también trae mercados,
 * agua potable, un parque y el asfaltado de una avenida urbana (unido a la E40
 * solo por cercanía), que no son proyectos viales.
 */
export function isRoadProject(description: unknown, rveSegments: unknown): boolean {
  const text = normalizeText(description);
  if (URBAN_WORDS.test(text)) return false;
  return Number(rveSegments) > 0 || ROAD_WORDS.test(text);
}

/** [oeste, sur, este, norte]. */
type Box = readonly [number, number, number, number];
/** ~1 km: recuadros que coinciden a esta distancia son el mismo trazado. */
const SAME_TRACE_DEGREES = 0.01;
/** Descripciones más cortas que esto no bastan para decir que dos obras son la misma. */
const MIN_SAME_DESCRIPTION = 40;

/** Si dos trazados son el mismo (sus recuadros coinciden a ~1 km). */
export function sameTrace(a: Box | null, b: Box | null): boolean {
  return !!a && !!b && a.every((value, i) => Math.abs(value - b[i]) <= SAME_TRACE_DEGREES);
}

/** Si dos descripciones son de la misma obra: iguales, o una es la otra recortada (como los Nro 10 y 31). */
export function sameDescription(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_SAME_DESCRIPTION && long.startsWith(short);
}

/** Cómo se ve una obra de la capa de obras ENOS en el mapa: su estado si cuenta en el índice, o por qué no cuenta. */
export type RoadProjectCategory = 'counted' | 'not-contracted' | 'not-road' | 'repeated';

/** Valor de `Estado_indice` de las obras que no cuentan (el mapa las dibuja punteadas). */
export const ROAD_PROJECT_LABELS: Record<Exclude<RoadProjectCategory, 'counted'>, string> = {
  'not-contracted': 'Por contratar',
  'not-road': 'Obra no vial',
  repeated: 'Registro repetido',
};

/** Cuántos de los datos del contrato trae un registro: entre registros repetidos queda el más completo. */
function completeness(properties: Record<string, unknown>): number {
  return ['Presupuesto_tot', 'Total_Obra', 'Fecha_inicio', 'Porcentaje_avance'].filter((field) => properties[field] != null).length;
}

/**
 * Qué obras de la capa de obras ENOS cuentan como proyecto vial del índice. Cada
 * registro se juzga por su propio estado: no cuenta si está por contratar o
 * adjudicar, ni si no es una obra vial. Entre los que cuentan, la capa repite
 * algunas obras en la misma provincia (mismo trazado, o la misma descripción
 * recortada; suele ser la misma obra en la lista de inversión y en la del PNC):
 * queda el registro con más datos del contrato (presupuesto, fechas, avance) y, a
 * igual cantidad, el de número menor; los demás son "repeated". Mismo orden que
 * `features`. Lee Nro, Provincia, Estado_actual, Accion_Esp, Join_Count, los
 * datos del contrato y el trazado.
 */
export function classifyRoadProjects(features: readonly GeoJsonFeature[]): RoadProjectCategory[] {
  const categories: RoadProjectCategory[] = features.map(({ properties }) => {
    const state = normalizeText(properties.Estado_actual);
    if (state !== 'EN EJECUCION' && state !== 'FINALIZADO') return 'not-contracted';
    return isRoadProject(properties.Accion_Esp, properties.Join_Count) ? 'counted' : 'not-road';
  });

  const candidates = features
    .map(({ properties, geometry }, i) => ({
      i,
      properties,
      province: normalizeText(properties.Provincia),
      text: normalizeText(properties.Accion_Esp),
      box: lineBox(geometry),
    }))
    .filter(({ i }) => categories[i] === 'counted')
    .sort((a, b) => completeness(b.properties) - completeness(a.properties) || Number(a.properties.Nro) - Number(b.properties.Nro));
  const kept: typeof candidates = [];
  for (const work of candidates) {
    const original = kept.find(
      (other) => other.province === work.province && (sameTrace(other.box, work.box) || sameDescription(other.text, work.text)),
    );
    if (original) categories[work.i] = 'repeated';
    else kept.push(work);
  }
  return categories;
}

/**
 * Agrega a cada obra `Estado_indice`: su estado si cuenta en el índice de
 * preparación, o el motivo por el que no (ROAD_PROJECT_LABELS). Así el mapa
 * muestra las mismas obras que cuenta el índice.
 */
export function annotateRoadProjects(features: GeoJsonFeature[]): GeoJsonFeature[] {
  const categories = classifyRoadProjects(features);
  return features.map((feature, i) => {
    const category = categories[i];
    return {
      ...feature,
      properties: {
        ...feature.properties,
        Estado_indice: category === 'counted' ? feature.properties.Estado_actual : ROAD_PROJECT_LABELS[category],
      },
    };
  });
}
