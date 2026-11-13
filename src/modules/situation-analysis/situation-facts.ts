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
    lugaresConMasLluviaEsperada: Array<{
      parroquia: string;
      canton: string;
      provincia: string;
      lluviaMm: number;
      enLasProximasHoras: number;
      categoriaDeLluvia: string;
      alerta: string;
    }>;
    provinciasConMasParroquiasEnAlertaAltaOMuyAlta?: Array<{ provincia: string; parroquias: number }>;
    /** Texto del documento de umbrales para la categoría más alta prevista. */
    consecuenciasPosiblesSegunLaCategoriaMasAlta: string;
  } | null;
  lluviaMedida: {
    fuente: 'estaciones del INAMHI';
    enLasUltimasHoras: number;
    estacionesConDatos: number;
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
    lugaresConMasLluviaEsperada: shown.flatMap((parish) => {
      const mm = decisiveMm(parish);
      if (mm === null || !parish.decidedBy) return [];
      return [
        {
          parroquia: parish.name,
          canton: parish.canton,
          provincia: parish.province,
          lluviaMm: mm,
          enLasProximasHoras: Number.parseInt(parish.decidedBy, 10),
          categoriaDeLluvia: parish.categoryLabel.toLowerCase(),
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
