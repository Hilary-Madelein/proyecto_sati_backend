import { toTitleCase } from '../../common/text/title-case.js';
import type { CantonAnalysisSnapshot, ParishAlert } from '../canton-analysis/canton-analysis.service.js';
import type { ParishPoint } from '../canton-analysis/parishes.js';
import { normalizeText } from '../canton-analysis/preparedness.js';
import { RAIN_BANDS, classifyRainWindow, type Semaphore } from '../canton-analysis/rain-thresholds.js';
import { HAZARD_TYPES } from '../events/domain/hazard-type.js';
import { SEVERITY_LABELS, SEVERITY_RANK } from '../events/domain/severity.js';
import type { HazardEventEntity } from '../events/entities/hazard-event.entity.js';
import { cantonsInZones } from '../flood-alerts/flash-flood-cantons.js';
import type { FlashFloodArea } from '../flood-hub/flood-hub-source.js';
import type { WeatherStationsSnapshot } from '../weather-stations/weather-stations.service.js';

/*
 * Los datos del momento de un lugar, ya resumidos y redondeados: es lo único que
 * recibe quien redacta el análisis (Gemini o la plantilla). Todo lo que sea una
 * cifra, un nivel o una comparación se decide aquí, no en la redacción.
 */

/** Un lugar para decidir si entra en el ámbito: su cantón (código DPA) y su provincia (nombre). */
export interface Place {
  cantonCode: string;
  province: string;
}

/** De qué lugar se pide el análisis: el país, una provincia o lo que eligió un chat de Telegram. */
export interface SituationScope {
  /** Identifica el ámbito en la caché. */
  key: string;
  /** Cómo se nombra en el texto, tras "en": "Ecuador", "la provincia de Manabí". */
  label: string;
  /** Abarca más de una provincia: se agrega el reparto por provincia. */
  severalProvinces: boolean;
  includes(place: Place): boolean;
}

export const NATIONAL_SCOPE: SituationScope = { key: 'ec', label: 'Ecuador', severalProvinces: true, includes: () => true };

export const sameProvince = (a: string, b: string) => normalizeText(a) === normalizeText(b);

export function provinceScope(province: string): SituationScope {
  return {
    key: `pv:${normalizeText(province)}`,
    label: `la provincia de ${province}`,
    severalProvinces: false,
    includes: (place) => sameProvince(place.province, province),
  };
}

export interface SituationInputs {
  now: Date;
  parishPoints: readonly ParishPoint[];
  /** null = no se pudo leer. */
  analysis: CantonAnalysisSnapshot | null;
  stations: WeatherStationsSnapshot | null;
  /** Crecidas repentinas de Google; null = la fuente no las dio. */
  flashFloods: readonly FlashFloodArea[] | null;
  /** Inundaciones de la SNGR de las últimas `EVENT_HOURS` horas. */
  events: readonly HazardEventEntity[] | null;
}

const LEVEL_LABELS: Record<Semaphore, string> = { red: 'muy alta', orange: 'alta', yellow: 'moderada', green: 'sin alerta' };

export interface SituationFacts {
  lugar: string;
  horaDeLosDatos: string;
  pronosticoDeLluvia: {
    fuente: 'pronóstico del INAMHI';
    vigenteHasta: string;
    parroquiasConPronostico: number;
    parroquiasEnAlertaMuyAlta: number;
    parroquiasEnAlertaAlta: number;
    parroquiasEnAlertaModerada: number;
    parroquiasEnAlertaAltaOMuyAlta: number;
    /** Qué tan extendida está la alerta alta o muy alta entre las parroquias del lugar. */
    extensionDeLaAlerta: 'ninguna' | 'puntual' | 'en varias parroquias' | 'extendida';
    categoriaDeLluviaMasAlta: string;
    lugaresConMasLluviaEsperada: Array<{
      parroquia: string;
      canton: string;
      provincia: string;
      lluviaMm: number;
      enLasProximasHoras: number;
      categoriaDeLluvia: string;
      /** Lluvia desde la que empieza esa categoría en ese mismo periodo. */
      umbralDeEsaCategoriaMm: number;
      comparacionConElUmbral: 'apenas sobre el umbral' | 'sobre el umbral' | 'el doble del umbral o más';
      /** El acumulado del día completo en el mismo lugar, para dar la proporción. */
      lluviaEn24HorasMm: number | null;
      categoriaEn24Horas: string | null;
      alerta: string;
    }>;
    provinciasConMasParroquiasEnAlertaAltaOMuyAlta?: Array<{ provincia: string; parroquias: number }>;
    /** Texto del documento de umbrales para la categoría más alta prevista. */
    consecuenciasPosiblesSegunLaCategoriaMasAlta: string;
  } | null;
  /**
   * Los cantones con más parroquias en alerta alta o muy alta, con lo que hay en
   * cada uno: sirve para decir qué significa la alerta ahí, no en general.
   */
  cantonesConParroquiasEnAlerta: Array<{
    canton: string;
    provincia: string;
    parroquiasEnAlertaAltaOMuyAlta: number;
    /** Otras señales del mismo cantón que refuerzan el pronóstico de lluvia; vacío = ninguna. */
    senialesQueCoinciden: string[];
    respaldoDeLaAlerta: 'señal aislada: solo el pronóstico de lluvia' | 'reforzada por otra señal' | 'reforzada por varias señales';
    /** Lo expuesto en el cantón; solo lo que hay (sin ceros). */
    expuesto: string[];
    /** Recursos para la respuesta en el cantón; solo lo que hay. */
    recursos: string[];
  }>;
  /**
   * Condición permanente del lugar según las capas de exposición, preparación y
   * respuesta: qué está expuesto, dónde se concentra y con qué se cuenta. null si
   * esas capas no se pudieron leer.
   */
  vulnerabilidadYPreparacion: {
    fuente: 'capas de exposición, preparación y respuesta del sistema (educación, salud, red vial, alojamientos)';
    expuesto: {
      poblacionesPropensasAInundaciones: number;
      institucionesEducativasEnZonasSusceptibles: number;
      institucionesEducativasConSusceptibilidadAltaAInundacion: number;
      estudiantesEnEsasInstituciones: number;
      centrosDeSalud: number;
      centrosDeSaludSusceptiblesAInundacion: number;
      puentes: number;
      puentesEnMalEstado: number;
      kmDeRedVialEstatal: number;
      kmDondeSeCirculaConPrecaucion: number;
      puntosCriticosEnLaRedVial: number;
    };
    preparacion: {
      alojamientosTemporales: number;
      campamentosViales: number;
      equiposDeMaquinariaPesada: number;
      accionesPreventivasRealizadas: number;
      obrasVialesEnEjecucion: number;
    };
    /** Dónde se concentra lo expuesto. */
    cantonesMasExpuestos: Array<{
      canton: string;
      poblacionesPropensasAInundaciones: number;
      institucionesEducativasConSusceptibilidadAlta: number;
      centrosDeSaludSusceptibles: number;
    }>;
    /** Solo de una provincia: su lugar entre las demás (puesto 1 = la que más tiene). */
    comparacionConLasDemasProvincias?: string[];
    /** Solo de una provincia: índice de preparación (puesto 1 = la más preparada). */
    indiceDePreparacion?: { nivel: string; puesto: number; deProvincias: number };
    /** Solo de una provincia: lectura de lo expuesto frente a la preparación. */
    lectura?: string;
  } | null;
  lluviaMedida: {
    fuente: 'estaciones del INAMHI';
    enLasUltimasHoras: number;
    estacionesConDatos: number;
    /** Si ninguna estación midió 1 mm o más: se dice así, sin lista. */
    huboLluviaApreciable: boolean;
    estacionesConMasLluvia: Array<{ estacion: string; ubicacion: string; lluviaMm: number; categoriaDeLluvia: string }>;
  } | null;
  crecidasRepentinas: {
    fuente: 'pronóstico de Google, no confirmado por la SNGR';
    vigenteHasta: string;
    cantonesMuyProbable: number;
    cantonesProbable: number;
    cantones: string[];
  } | null;
  rios: {
    fuente: 'modelo GEOGLOWS de caudales, hoy y mañana';
    tramosDeRioEnAlerta: number;
    cantonesConTramosEnAlerta: number;
    /** La crecida más grande prevista: ocurre en promedio una vez cada tantos años. */
    crecidaMasGrandeUnaVezCadaAnios: number;
    cantonesConMasTramos: Array<{ canton: string; provincia: string; tramos: number }>;
  } | null;
  inundacionesReportadas: {
    fuente: 'SNGR';
    enLasUltimasHoras: number;
    total: number;
    criticas: number;
    altas: number;
    conDanios: number;
    personasAfectadas: number;
    masGraves: Array<{ tipo: string; canton: string; provincia: string; nivel: string; hora: string }>;
  } | null;
  /** Lo que no se pudo leer ahora: el texto debe decir que falta, no suponerlo. */
  datosNoDisponibles: string[];
}

/** Horas hacia atrás de los eventos de la SNGR que cuentan como "del momento". */
export const EVENT_HOURS = 24;
const TOP_PLACES = 5;
/** Con menos horas con dato, el total de una estación no representa el periodo. */
const MIN_STATION_HOURS = 6;
/** Más lejos que esto de cualquier parroquia, una estación no se asigna a un lugar. */
const STATION_MAX_KM = 30;
const KM_PER_DEGREE = 111.32;

const timeFormat = new Intl.DateTimeFormat('es-EC', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Guayaquil',
});
export const formatTime = (date: Date | string) => timeFormat.format(new Date(date));

/** Parroquia más cercana a un punto (distancia aproximada, suficiente a esta escala). */
function nearestParish(points: readonly ParishPoint[], lat: number, lng: number): { parish: ParishPoint; km: number } | null {
  const cos = Math.cos((lat * Math.PI) / 180);
  let best: { parish: ParishPoint; km: number } | null = null;
  for (const parish of points) {
    const km = Math.hypot((parish.lng - lng) * cos, parish.lat - lat) * KM_PER_DEGREE;
    if (!best || km < best.km) best = { parish, km };
  }
  return best;
}

export function buildFacts(scope: SituationScope, inputs: SituationInputs): SituationFacts {
  const { now, parishPoints, analysis, stations, flashFloods, events } = inputs;
  const missing: string[] = [];
  for (const source of analysis?.sources ?? []) if (!source.ok) missing.push(source.name);

  return {
    lugar: scope.label,
    horaDeLosDatos: formatTime(now),
    pronosticoDeLluvia: forecastFacts(scope, analysis, missing),
    cantonesConParroquiasEnAlerta: alertCantonFacts(scope, inputs),
    vulnerabilidadYPreparacion: vulnerabilityFacts(scope, analysis, missing),
    lluviaMedida: measuredFacts(scope, stations, parishPoints, missing),
    crecidasRepentinas: flashFloodFacts(scope, flashFloods, parishPoints, now, missing),
    rios: riverFacts(scope, analysis),
    inundacionesReportadas: eventFacts(scope, events, parishPoints, missing),
    datosNoDisponibles: [...new Set(missing)],
  };
}

function forecastFacts(scope: SituationScope, analysis: CantonAnalysisSnapshot | null, missing: string[]): SituationFacts['pronosticoDeLluvia'] {
  if (!analysis?.forecast24h) {
    missing.push('Pronóstico de lluvia');
    return null;
  }
  // Ya vienen de la más a la menos afectada.
  const parishes = analysis.parishes.filter((parish) => scope.includes(parish));
  const count = (level: Semaphore) => parishes.filter((parish) => parish.semaphore === level).length;
  const high = parishes.filter(({ semaphore }) => semaphore === 'red' || semaphore === 'orange');
  const shown = (high.length > 0 ? high : parishes.filter(({ semaphore }) => semaphore === 'yellow')).slice(0, TOP_PLACES);

  const byProvince = new Map<string, number>();
  for (const { province } of high) byProvince.set(province, (byProvince.get(province) ?? 0) + 1);
  const worst = parishes[0] ? (RAIN_BANDS.find((band) => band.category === parishes[0].category) ?? RAIN_BANDS[0]) : RAIN_BANDS[0];

  return {
    fuente: 'pronóstico del INAMHI',
    vigenteHasta: formatTime(analysis.forecast24h.to),
    parroquiasConPronostico: parishes.length,
    parroquiasEnAlertaMuyAlta: count('red'),
    parroquiasEnAlertaAlta: count('orange'),
    parroquiasEnAlertaModerada: count('yellow'),
    parroquiasEnAlertaAltaOMuyAlta: high.length,
    extensionDeLaAlerta: spreadOf(high.length, parishes.length),
    categoriaDeLluviaMasAlta: worst.label.toLowerCase(),
    lugaresConMasLluviaEsperada: shown.flatMap((parish) => {
      const mm = decisiveMm(parish);
      if (mm === null || !parish.decidedBy) return [];
      const band = RAIN_BANDS.find((item) => item.category === parish.category) ?? RAIN_BANDS[0];
      const threshold = band[`from${parish.decidedBy}`];
      const day = parish.forecast.mm24h;
      const dayCategory = RAIN_BANDS.find((item) => item.category === parish.forecast.category24h);
      return [
        {
          parroquia: parish.name,
          canton: parish.canton,
          provincia: parish.province,
          lluviaMm: mm,
          enLasProximasHoras: Number.parseInt(parish.decidedBy, 10),
          categoriaDeLluvia: parish.categoryLabel.toLowerCase(),
          umbralDeEsaCategoriaMm: threshold,
          comparacionConElUmbral: mm >= threshold * 2 ? 'el doble del umbral o más' : mm >= threshold * 1.3 ? 'sobre el umbral' : 'apenas sobre el umbral',
          lluviaEn24HorasMm: day === null ? null : Math.round(day),
          categoriaEn24Horas: dayCategory ? dayCategory.label.toLowerCase() : null,
          alerta: LEVEL_LABELS[parish.semaphore],
        },
      ];
    }),
    ...(scope.severalProvinces &&
      byProvince.size > 1 && {
        provinciasConMasParroquiasEnAlertaAltaOMuyAlta: [...byProvince.entries()]
          .sort(([, a], [, b]) => b - a)
          .slice(0, TOP_PLACES)
          .map(([provincia, parroquias]) => ({ provincia, parroquias })),
      }),
    consecuenciasPosiblesSegunLaCategoriaMasAlta: worst.consequences,
  };
}

/** Lluvia de 24 h desde la que el suelo ya viene mojado: el umbral de lluvia moderada. */
const WET_GROUND_MM = 10;
const TOP_CANTONS = 3;

const amount = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

/** Lo que hay en los cantones con más parroquias en alerta: otras señales, lo expuesto y los recursos. */
function alertCantonFacts(scope: SituationScope, inputs: SituationInputs): SituationFacts['cantonesConParroquiasEnAlerta'] {
  const { analysis, stations, flashFloods, parishPoints, now } = inputs;
  if (!analysis?.forecast24h) return [];
  const byCanton = new Map<string, { red: number; total: number; canton: string; province: string }>();
  for (const parish of analysis.parishes) {
    if ((parish.semaphore !== 'red' && parish.semaphore !== 'orange') || !scope.includes(parish)) continue;
    const row = byCanton.get(parish.cantonCode) ?? { red: 0, total: 0, canton: parish.canton, province: parish.province };
    row.total += 1;
    if (parish.semaphore === 'red') row.red += 1;
    byCanton.set(parish.cantonCode, row);
  }
  const top = [...byCanton.entries()].sort(([, a], [, b]) => b.red - a.red || b.total - a.total).slice(0, TOP_CANTONS);
  if (top.length === 0) return [];

  /** La estación con más lluvia de cada cantón. */
  const measured = new Map<string, number>();
  for (const station of stations?.stations ?? []) {
    if (station.totalMm === null || station.hoursWithData < MIN_STATION_HOURS) continue;
    const near = nearestParish(parishPoints, station.lat, station.lng);
    if (!near || near.km > STATION_MAX_KM) continue;
    measured.set(near.parish.cantonCode, Math.max(measured.get(near.parish.cantonCode) ?? 0, Math.round(station.totalMm)));
  }
  const current = (flashFloods ?? []).filter((zone) => Date.parse(zone.validUntil) > now.getTime());
  const flash = new Map(cantonsInZones(current, parishPoints).map((canton) => [canton.code, canton.likelihood]));
  const details = new Map(analysis.cantons.map((canton) => [canton.code, canton]));

  return top.map(([code, row]) => {
    const canton = details.get(code);
    const signals: string[] = [];
    const rain = measured.get(code) ?? 0;
    if (rain >= WET_GROUND_MM) signals.push(`${rain} mm ya medidos en las últimas ${stations?.windowHours ?? 24} horas (el suelo ya está mojado)`);
    if (canton && canton.triggers.riverAlerts > 0) signals.push(`${amount(canton.triggers.riverAlerts, 'tramo de río', 'tramos de río')} en alerta por caudal`);
    const likelihood = flash.get(code);
    if (likelihood) signals.push(`crecida repentina ${likelihood === 'highly_likely' ? 'muy probable' : 'probable'} según Google (no confirmada por la SNGR)`);
    if (canton && canton.triggers.sngrEvents > 0) {
      signals.push(`${amount(canton.triggers.sngrEvents, 'inundación reportada', 'inundaciones reportadas')} por la SNGR en las últimas 72 horas`);
    }
    const listed = (items: Array<[number | undefined, string, string]>) =>
      items.flatMap(([value, one, many]) => (value && value > 0 ? [amount(Math.round(value), one, many)] : []));
    return {
      canton: row.canton,
      provincia: row.province,
      parroquiasEnAlertaAltaOMuyAlta: row.total,
      senialesQueCoinciden: signals,
      respaldoDeLaAlerta:
        signals.length === 0 ? 'señal aislada: solo el pronóstico de lluvia' : signals.length === 1 ? 'reforzada por otra señal' : 'reforzada por varias señales',
      expuesto: listed([
        [canton?.exposed.floodTowns, 'población propensa a inundaciones', 'poblaciones propensas a inundaciones'],
        [canton?.exposed.schoolsHighFlood, 'institución educativa con susceptibilidad alta a inundación', 'instituciones educativas con susceptibilidad alta a inundación'],
        [canton?.exposed.healthFloodSusceptible, 'centro de salud susceptible a inundación', 'centros de salud susceptibles a inundación'],
        [canton?.triggers.criticalPoints, 'punto crítico en la red vial estatal', 'puntos críticos en la red vial estatal'],
        [canton?.exposed.bridgesBad, 'puente en mal estado', 'puentes en mal estado'],
        [canton?.response.roadEventsOpen, 'evento abierto en vías', 'eventos abiertos en vías'],
      ]),
      recursos: listed([[canton?.response.shelters, 'alojamiento temporal', 'alojamientos temporales']]),
    };
  });
}

const PREPAREDNESS_LABELS: Record<string, string> = { 'very-low': 'muy baja', low: 'baja', medium: 'media', high: 'alta', 'very-high': 'muy alta' };

type CantonRow = CantonAnalysisSnapshot['cantons'][number];
/** Lo que más pesa al comparar lo expuesto de un cantón o de una provincia. */
const exposureOf = (canton: CantonRow) => canton.exposed.schoolsHighFlood + canton.exposed.healthFloodSusceptible + canton.exposed.floodTowns;

/** Vulnerabilidad del lugar con las capas auxiliares: lo expuesto, dónde se concentra y con qué se cuenta. */
function vulnerabilityFacts(scope: SituationScope, analysis: CantonAnalysisSnapshot | null, missing: string[]): SituationFacts['vulnerabilidadYPreparacion'] {
  if (!analysis || analysis.sources.some((source) => source.name === 'Capas de exposición y respuesta' && !source.ok)) {
    if (!analysis) missing.push('Capas de exposición y respuesta');
    return null;
  }
  const cantons = analysis.cantons.filter((canton) => scope.includes({ cantonCode: canton.code, province: canton.province }));
  if (cantons.length === 0) return null;
  const sum = (value: (canton: CantonRow) => number) => Math.round(cantons.reduce((total, canton) => total + value(canton), 0));
  // La maquinaria viene por provincia y repetida en cada cantón: se cuenta una vez por provincia.
  const machinery = new Map(cantons.map((canton) => [normalizeText(canton.province), canton.response.provinceMachinery]));

  const result: NonNullable<SituationFacts['vulnerabilidadYPreparacion']> = {
    fuente: 'capas de exposición, preparación y respuesta del sistema (educación, salud, red vial, alojamientos)',
    expuesto: {
      poblacionesPropensasAInundaciones: sum((canton) => canton.exposed.floodTowns),
      institucionesEducativasEnZonasSusceptibles: sum((canton) => canton.exposed.schools),
      institucionesEducativasConSusceptibilidadAltaAInundacion: sum((canton) => canton.exposed.schoolsHighFlood),
      estudiantesEnEsasInstituciones: sum((canton) => canton.exposed.students),
      centrosDeSalud: sum((canton) => canton.exposed.healthCenters),
      centrosDeSaludSusceptiblesAInundacion: sum((canton) => canton.exposed.healthFloodSusceptible),
      puentes: sum((canton) => canton.exposed.bridges),
      puentesEnMalEstado: sum((canton) => canton.exposed.bridgesBad),
      kmDeRedVialEstatal: sum((canton) => canton.exposed.rveKm),
      kmDondeSeCirculaConPrecaucion: sum((canton) => canton.exposed.rveCautionKm),
      puntosCriticosEnLaRedVial: sum((canton) => canton.triggers.criticalPoints),
    },
    preparacion: {
      alojamientosTemporales: sum((canton) => canton.response.shelters),
      campamentosViales: sum((canton) => canton.response.camps),
      equiposDeMaquinariaPesada: [...machinery.values()].reduce((total, value) => total + value, 0),
      accionesPreventivasRealizadas: sum((canton) => canton.preventive.actions),
      obrasVialesEnEjecucion: sum((canton) => canton.preventive.enosWorksActive),
    },
    cantonesMasExpuestos: [...cantons]
      .filter((canton) => exposureOf(canton) > 0)
      .sort((a, b) => exposureOf(b) - exposureOf(a))
      .slice(0, 3)
      .map((canton) => ({
        canton: scope.severalProvinces ? `${canton.name} (${canton.province})` : canton.name,
        poblacionesPropensasAInundaciones: canton.exposed.floodTowns,
        institucionesEducativasConSusceptibilidadAlta: canton.exposed.schoolsHighFlood,
        centrosDeSaludSusceptibles: canton.exposed.healthFloodSusceptible,
      })),
  };
  if (scope.severalProvinces) return result;

  // De una sola provincia: su lugar entre las demás y su índice de preparación.
  const province = normalizeText(cantons[0].province);
  const totals = new Map<string, { schools: number; health: number; towns: number }>();
  // Solo provincias: las zonas no delimitadas no cuentan como una.
  const known = new Set(analysis.provinces.map((item) => normalizeText(item.name)));
  for (const canton of analysis.cantons) {
    const key = normalizeText(canton.province);
    if (key.includes('DELIMITADA') || (known.size > 0 && !known.has(key))) continue;
    const row = totals.get(key) ?? { schools: 0, health: 0, towns: 0 };
    row.schools += canton.exposed.schoolsHighFlood;
    row.health += canton.exposed.healthFloodSusceptible;
    row.towns += canton.exposed.floodTowns;
    totals.set(key, row);
  }
  const own = totals.get(province);
  if (!own || totals.size < 2) return result;
  const rankOf = (value: (row: { schools: number; health: number; towns: number }) => number) =>
    1 + [...totals.values()].filter((row) => value(row) > value(own)).length;
  const ranks = [
    { rank: rankOf((row) => row.schools), value: own.schools, label: 'instituciones educativas con susceptibilidad alta a inundación' },
    { rank: rankOf((row) => row.health), value: own.health, label: 'centros de salud susceptibles a inundación' },
    { rank: rankOf((row) => row.towns), value: own.towns, label: 'poblaciones propensas a inundaciones' },
  ].filter(({ value }) => value > 0);
  if (ranks.length > 0) {
    result.comparacionConLasDemasProvincias = ranks.map(({ rank, label }) => `puesto ${rank} de ${totals.size} provincias por ${label}`);
  }
  const position = analysis.provinces.findIndex((item) => normalizeText(item.name) === province);
  const prepared = position >= 0 ? analysis.provinces[position] : null;
  if (prepared) {
    result.indiceDePreparacion = { nivel: PREPAREDNESS_LABELS[prepared.level] ?? prepared.level, puesto: position + 1, deProvincias: analysis.provinces.length };
  }
  if (ranks.length > 0) {
    const best = Math.min(...ranks.map(({ rank }) => rank));
    const third = Math.ceil(totals.size / 3);
    const exposure = best <= third ? 'alta' : best <= third * 2 ? 'media' : 'baja';
    result.lectura = `exposición ${exposure} frente a las demás provincias${prepared ? ` y preparación ${result.indiceDePreparacion!.nivel} según el índice` : ''}`;
  }
  return result;
}

/** Alerta alta o muy alta en hasta el 5 % de las parroquias, o en 1 o 2 si no llegan al 30 %, es puntual; desde el 30 %, extendida. */
function spreadOf(high: number, total: number): NonNullable<SituationFacts['pronosticoDeLluvia']>['extensionDeLaAlerta'] {
  if (high === 0 || total === 0) return 'ninguna';
  const share = high / total;
  if (share >= 0.3) return 'extendida';
  return high <= 2 || share <= 0.05 ? 'puntual' : 'en varias parroquias';
}

/** Lluvia de la ventana que decidió el nivel, sin decimales (a esta escala serían falsa precisión). */
function decisiveMm({ decidedBy, forecast }: ParishAlert): number | null {
  const mm = decidedBy ? forecast[`mm${decidedBy}`] : null;
  return mm === null ? null : Math.round(mm);
}

function measuredFacts(
  scope: SituationScope,
  stations: WeatherStationsSnapshot | null,
  parishPoints: readonly ParishPoint[],
  missing: string[],
): SituationFacts['lluviaMedida'] {
  if (!stations) {
    missing.push('Lluvia medida en estaciones');
    return null;
  }
  const reporting = stations.stations.flatMap((station) => {
    if (station.totalMm === null || station.hoursWithData < MIN_STATION_HOURS) return [];
    const near = nearestParish(parishPoints, station.lat, station.lng);
    if (!near || near.km > STATION_MAX_KM || !scope.includes(near.parish)) return [];
    return [{ station, parish: near.parish, mm: Math.round(station.totalMm) }];
  });
  if (reporting.length === 0) {
    missing.push('Lluvia medida en estaciones');
    return null;
  }
  return {
    fuente: 'estaciones del INAMHI',
    enLasUltimasHoras: stations.windowHours,
    estacionesConDatos: reporting.length,
    huboLluviaApreciable: reporting.some(({ mm }) => mm >= 1),
    estacionesConMasLluvia: reporting
      .filter(({ mm }) => mm >= 1)
      .sort((a, b) => b.mm - a.mm)
      .slice(0, TOP_PLACES)
      .map(({ station, parish, mm }) => ({
        estacion: toTitleCase(station.name),
        ubicacion: `${parish.canton}, ${parish.province}`,
        lluviaMm: mm,
        categoriaDeLluvia: classifyRainWindow(mm, '24h').label.toLowerCase(),
      })),
  };
}

function flashFloodFacts(
  scope: SituationScope,
  flashFloods: readonly FlashFloodArea[] | null,
  parishPoints: readonly ParishPoint[],
  now: Date,
  missing: string[],
): SituationFacts['crecidasRepentinas'] {
  if (!flashFloods) {
    missing.push('Crecidas repentinas de Google');
    return null;
  }
  const current = flashFloods.filter((zone) => Date.parse(zone.validUntil) > now.getTime());
  const cantons = cantonsInZones(current, parishPoints)
    .filter((canton) => scope.includes({ cantonCode: canton.code, province: canton.province }))
    .sort((a, b) => Number(b.likelihood === 'highly_likely') - Number(a.likelihood === 'highly_likely') || a.canton.localeCompare(b.canton, 'es'));
  if (cantons.length === 0) return { fuente: 'pronóstico de Google, no confirmado por la SNGR', vigenteHasta: '', cantonesMuyProbable: 0, cantonesProbable: 0, cantones: [] };
  return {
    fuente: 'pronóstico de Google, no confirmado por la SNGR',
    vigenteHasta: formatTime(new Date(Math.max(...current.map((zone) => Date.parse(zone.validUntil))))),
    cantonesMuyProbable: cantons.filter(({ likelihood }) => likelihood === 'highly_likely').length,
    cantonesProbable: cantons.filter(({ likelihood }) => likelihood === 'likely').length,
    cantones: cantons.slice(0, TOP_PLACES + 1).map(({ canton, province }) => (scope.severalProvinces ? `${canton} (${province})` : canton)),
  };
}

function riverFacts(scope: SituationScope, analysis: CantonAnalysisSnapshot | null): SituationFacts['rios'] {
  // Si la fuente falló ya quedó anotada entre los datos no disponibles (viene en `sources`).
  if (!analysis || analysis.sources.some((source) => source.name === 'Alertas por caudal' && !source.ok)) return null;
  const cantons = analysis.cantons
    .filter((canton) => canton.triggers.riverAlerts > 0 && scope.includes({ cantonCode: canton.code, province: canton.province }))
    .sort((a, b) => b.triggers.riverAlerts - a.triggers.riverAlerts);
  return {
    fuente: 'modelo GEOGLOWS de caudales, hoy y mañana',
    tramosDeRioEnAlerta: cantons.reduce((sum, canton) => sum + canton.triggers.riverAlerts, 0),
    cantonesConTramosEnAlerta: cantons.length,
    crecidaMasGrandeUnaVezCadaAnios: Math.max(0, ...cantons.map((canton) => canton.triggers.riverMaxLevel)),
    cantonesConMasTramos: cantons.slice(0, 3).map((canton) => ({ canton: canton.name, provincia: canton.province, tramos: canton.triggers.riverAlerts })),
  };
}

function eventFacts(
  scope: SituationScope,
  events: readonly HazardEventEntity[] | null,
  parishPoints: readonly ParishPoint[],
  missing: string[],
): SituationFacts['inundacionesReportadas'] {
  if (!events) {
    missing.push('Eventos de la SNGR');
    return null;
  }
  const cantonCodes = new Map(parishPoints.map((parish) => [`${normalizeText(parish.province)}|${normalizeText(parish.canton)}`, parish.cantonCode]));
  /** La provincia la da la SNGR; el cantón, su nombre o, si no se reconoce, la parroquia más cercana al punto. */
  const placeOf = (event: HazardEventEntity): Place | null => {
    const [lng, lat] = event.location.coordinates;
    const near = nearestParish(parishPoints, lat, lng)?.parish;
    const province = event.province ?? near?.province;
    if (!province) return null;
    const cantonCode = cantonCodes.get(`${normalizeText(province)}|${normalizeText(event.canton)}`) ?? near?.cantonCode ?? '';
    return { cantonCode, province };
  };
  const inScope = events.filter((event) => {
    const place = placeOf(event);
    return place !== null && scope.includes(place);
  });
  const worstFirst = [...inScope].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
  return {
    fuente: 'SNGR',
    enLasUltimasHoras: EVENT_HOURS,
    total: inScope.length,
    criticas: inScope.filter(({ severity }) => severity === 'critical').length,
    altas: inScope.filter(({ severity }) => severity === 'high').length,
    conDanios: inScope.filter(({ hasDamage }) => hasDamage).length,
    personasAfectadas: inScope.reduce((sum, event) => sum + (event.affected ?? 0), 0),
    masGraves: worstFirst.slice(0, 4).map((event) => ({
      tipo: HAZARD_TYPES[event.hazardType].toLowerCase(),
      canton: toTitleCase(event.canton ?? ''),
      provincia: toTitleCase(event.province ?? ''),
      nivel: SEVERITY_LABELS[event.severity].toLowerCase(),
      hora: formatTime(event.occurredAt),
    })),
  };
}
