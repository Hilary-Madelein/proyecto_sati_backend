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
import { EXCEPTIONAL_RAIN_24H_MM, PAST_NINOS, seaReading, type PastNino } from './nino-history.js';
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

/** "Manabí", "Manabí y Loja", "Manabí, Guayas y Loja". */
const joinNames = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`);

/**
 * Varias provincias juntas (las que se eligieron en el visor). Con una sola es la de
 * esa provincia (comparte la caché). El orden no importa: la clave va ordenada.
 */
export function provincesScope(provinces: readonly string[]): SituationScope {
  const names = [...new Map(provinces.map((name) => [normalizeText(name), name])).entries()].sort(([a], [b]) => a.localeCompare(b));
  if (names.length === 1) return provinceScope(names[0][1]);
  return {
    key: `pvs:${names.map(([key]) => key).join(',')}`,
    label: `las provincias de ${joinNames(names.map(([, name]) => name))}`,
    severalProvinces: true,
    includes: (place) => names.some(([, name]) => sameProvince(place.province, name)),
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
  /** Inundaciones de la SNGR de los últimos `HISTORY_DAYS` días: las de las últimas `EVENT_HOURS` horas son "del momento" y todas, el antecedente. */
  events: readonly HazardEventEntity[] | null;
  /** Cuenca hidrográfica de cada parroquia, por su código; null = no se pudo leer. */
  basins?: ReadonlyMap<string, string> | null;
  /** Anomalía del mar en la región Niño 1+2 (°C) y el día del dato; null = no se pudo leer. */
  sea?: { nino12Anomaly: number | null; time: string } | null;
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
   * Los cantones con más parroquias en alerta (alta o muy alta; si no hay, moderada),
   * con lo que hay en cada uno: sirve para decir qué puede pasar ahí, no en general.
   */
  cantonesConParroquiasEnAlerta: Array<{
    canton: string;
    provincia: string;
    /** Cuenca hidrográfica donde está el cantón; null si no se conoce. */
    cuenca: string | null;
    parroquiasEnAlerta: number;
    nivelDeAlertaMasAlto: string;
    /** La lluvia más alta prevista en el cantón, con su periodo y categoría. */
    lluviaMasAltaEsperada: string | null;
    /** Otras señales del mismo cantón que refuerzan el pronóstico de lluvia; vacío = ninguna. */
    senialesQueCoinciden: string[];
    respaldoDeLaAlerta: 'señal aislada: solo el pronóstico de lluvia' | 'reforzada por otra señal' | 'reforzada por varias señales';
    /** Lo que ya pasó ahí: inundaciones reportadas y zonas que se han inundado antes. Vacío = sin antecedentes en los datos. */
    antecedentesDeInundacion: string[];
    /** Población y servicios expuestos en el cantón; solo lo que hay (sin ceros). */
    expuesto: string[];
    /** Red vial estatal del cantón y su estado: km, tramos con precaución, puntos críticos, puentes, novedades abiertas. */
    redVial: string[];
    /** Susceptibilidad a deslizamientos, que la lluvia puede empeorar; vacío = las capas no registran zonas ahí. */
    deslizamientos: string[];
    /** Recursos para la respuesta en el cantón; solo lo que hay. */
    recursos: string[];
  }>;
  /**
   * Cantones de fuera del lugar analizado, a menos de `NEIGHBOR_KM` km, que también
   * tienen señales: el agua no sigue los límites administrativos. Vacío = los vecinos
   * no tienen señales; null = no aplica (todo el país) o no se pudo calcular.
   */
  cantonesVecinosConSeniales: Array<{
    canton: string;
    provincia: string;
    /** Cuenca que comparte con el lugar analizado; null = no comparte cuenca (solo cercanía). */
    cuencaCompartida: string | null;
    seniales: string[];
  }> | null;
  /** Antecedente del lugar: inundaciones que la SNGR reportó en el periodo guardado. */
  historialDeInundaciones: {
    fuente: 'SNGR';
    desde: string;
    total: number;
    cantonesConMasInundaciones: Array<{ canton: string; provincia: string; inundaciones: number }>;
  } | null;
  /**
   * Solo cuando se prevé una lluvia excepcional (categoría extrema, o desde
   * `EXCEPTIONAL_RAIN_24H_MM` mm en 24 horas): los episodios anteriores de El Niño,
   * para dar proporción. En los demás casos el campo no viene y no se comparan.
   */
  comparacionConNiniosAnteriores?: {
    motivo: string;
    /** Calentamiento del mar frente a Ecuador y Perú hoy: grados sobre lo normal. null = sin dato ahora. */
    calentamientoDelMarHoyC: number | null;
    fechaDelDatoDelMar: string | null;
    episodiosAnteriores: readonly PastNino[];
    /** Cómo queda el mar de hoy frente a los picos anteriores; null si no hay dato de hoy. */
    lectura: string | null;
    advertencia: string;
  };
  /** Con qué se arma el plan de contingencia: las acciones del documento de umbrales y los recursos que el sistema registra. */
  basesDelPlanDeContingencia: {
    accionesSegunLaCategoriaDeLluviaMasAlta: string;
    recursosDelLugar: string[];
    /** Provincias vecinas con señales en la misma cuenca o junto al límite: con ellas se coordina. */
    provinciasVecinasConLasQueCoordinar: string[];
  };
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
      /** null = la capa no se pudo leer. */
      novedadesVialesAbiertas: number | null;
      kmCuadradosConSusceptibilidadMuyAltaADeslizamientos: number | null;
      kmCuadradosQueSeHanInundadoAntes: number | null;
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
/** Días hacia atrás de inundaciones de la SNGR que cuentan como antecedente. */
export const HISTORY_DAYS = 90;
/** Un cantón de fuera es vecino si alguna de sus parroquias está a esta distancia de una del lugar analizado. */
const NEIGHBOR_KM = 30;
const TOP_NEIGHBORS = 3;
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

  const context = signalContext(inputs);
  const forecast = forecastFacts(scope, analysis, missing);
  const vulnerability = vulnerabilityFacts(scope, analysis, missing);
  const neighbors = neighborFacts(scope, inputs, context);
  return {
    lugar: scope.label,
    horaDeLosDatos: formatTime(now),
    pronosticoDeLluvia: forecast,
    cantonesConParroquiasEnAlerta: alertCantonFacts(scope, inputs, context),
    cantonesVecinosConSeniales: neighbors,
    historialDeInundaciones: historyFacts(scope, context),
    ...ninoFacts(scope, inputs),
    basesDelPlanDeContingencia: planFacts(forecast, vulnerability, neighbors),
    vulnerabilidadYPreparacion: vulnerability,
    lluviaMedida: measuredFacts(scope, stations, parishPoints, missing),
    crecidasRepentinas: flashFloodFacts(scope, flashFloods, parishPoints, now, missing),
    rios: riverFacts(scope, analysis),
    inundacionesReportadas: eventFacts(scope, events, parishPoints, now, missing),
    datosNoDisponibles: [...new Set(missing)],
  };
}

const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'long', timeZone: 'America/Guayaquil' });

/** Cantón y provincia de un evento: la provincia la da la SNGR; el cantón, su nombre o, si no se reconoce, la parroquia más cercana al punto. */
function eventPlacer(parishPoints: readonly ParishPoint[]): (event: HazardEventEntity) => Place | null {
  const cantonCodes = new Map(parishPoints.map((parish) => [`${normalizeText(parish.province)}|${normalizeText(parish.canton)}`, parish.cantonCode]));
  return (event) => {
    const [lng, lat] = event.location.coordinates;
    const near = nearestParish(parishPoints, lat, lng)?.parish;
    const province = event.province ?? near?.province;
    if (!province) return null;
    const cantonCode = cantonCodes.get(`${normalizeText(province)}|${normalizeText(event.canton)}`) ?? near?.cantonCode ?? '';
    return { cantonCode, province };
  };
}

/** Lo que se sabe de cada cantón del país, se analice o no: sirve para el lugar pedido y para sus vecinos. */
interface SignalContext {
  /** La estación con más lluvia de cada cantón (mm). */
  measured: Map<string, number>;
  /** Crecida repentina de Google vigente, por cantón. */
  flash: Map<string, 'likely' | 'highly_likely'>;
  details: Map<string, CantonRow>;
  /** Inundaciones de la SNGR del periodo guardado, por cantón. */
  history: Map<string, { count: number; province: string }>;
  /** Fecha de la inundación más antigua del periodo; null si no hay ninguna. */
  historySince: Date | null;
  /** Cuenca de cada cantón: la de la mayoría de sus parroquias. */
  basins: Map<string, string>;
  /** Nombre, provincia y puntos de cada cantón, según sus parroquias. */
  places: Map<string, { canton: string; province: string; points: ParishPoint[] }>;
}

function signalContext({ analysis, stations, flashFloods, parishPoints, now, events, basins }: SituationInputs): SignalContext {
  const measured = new Map<string, number>();
  for (const station of stations?.stations ?? []) {
    if (station.totalMm === null || station.hoursWithData < MIN_STATION_HOURS) continue;
    const near = nearestParish(parishPoints, station.lat, station.lng);
    if (!near || near.km > STATION_MAX_KM) continue;
    measured.set(near.parish.cantonCode, Math.max(measured.get(near.parish.cantonCode) ?? 0, Math.round(station.totalMm)));
  }
  const current = (flashFloods ?? []).filter((zone) => Date.parse(zone.validUntil) > now.getTime());

  const history = new Map<string, { count: number; province: string }>();
  let historySince: Date | null = null;
  const placeOf = eventPlacer(parishPoints);
  for (const event of events ?? []) {
    const place = placeOf(event);
    if (!place || !place.cantonCode) continue;
    const row = history.get(place.cantonCode) ?? { count: 0, province: place.province };
    row.count += 1;
    history.set(place.cantonCode, row);
    if (!historySince || event.occurredAt < historySince) historySince = event.occurredAt;
  }

  const places: SignalContext['places'] = new Map();
  const votes = new Map<string, Map<string, number>>();
  for (const parish of parishPoints) {
    const place = places.get(parish.cantonCode) ?? { canton: parish.canton, province: parish.province, points: [] };
    place.points.push(parish);
    places.set(parish.cantonCode, place);
    const basin = basins?.get(parish.code);
    if (!basin) continue;
    const count = votes.get(parish.cantonCode) ?? new Map<string, number>();
    count.set(basin, (count.get(basin) ?? 0) + 1);
    votes.set(parish.cantonCode, count);
  }
  return {
    measured,
    flash: new Map(cantonsInZones(current, parishPoints).map((canton) => [canton.code, canton.likelihood])),
    details: new Map((analysis?.cantons ?? []).map((canton) => [canton.code, canton])),
    history,
    historySince,
    basins: new Map([...votes.entries()].map(([code, count]) => [code, [...count.entries()].sort(([, a], [, b]) => b - a)[0][0]])),
    places,
  };
}

/** Señales de un cantón aparte del pronóstico de lluvia: lluvia ya medida, ríos, crecida de Google e inundaciones recientes. */
function signalsOf(code: string, context: SignalContext, windowHours: number): string[] {
  const canton = context.details.get(code);
  const signals: string[] = [];
  const rain = context.measured.get(code) ?? 0;
  if (rain >= WET_GROUND_MM) signals.push(`${rain} mm ya medidos en las últimas ${windowHours} horas (el suelo ya está mojado)`);
  if (canton && canton.triggers.riverAlerts > 0) signals.push(`${amount(canton.triggers.riverAlerts, 'tramo de río', 'tramos de río')} en alerta por caudal`);
  const likelihood = context.flash.get(code);
  if (likelihood) signals.push(`crecida repentina ${likelihood === 'highly_likely' ? 'muy probable' : 'probable'} según Google (no confirmada por la SNGR)`);
  if (canton && canton.triggers.sngrEvents > 0) {
    signals.push(`${amount(canton.triggers.sngrEvents, 'inundación reportada', 'inundaciones reportadas')} por la SNGR en las últimas 72 horas`);
  }
  return signals;
}

/** "62 mm en 24 horas (lluvia intensa)" de la parroquia con más lluvia de una lista ya ordenada de la más a la menos afectada. */
function topRain(parishes: readonly ParishAlert[]): string | null {
  const top = parishes[0];
  const mm = top ? decisiveMm(top) : null;
  if (!top || mm === null || !top.decidedBy) return null;
  return `${mm} mm en ${Number.parseInt(top.decidedBy, 10)} horas (lluvia ${top.categoryLabel.toLowerCase()})`;
}

/** Cantones de fuera del lugar, cercanos a él, con señales propias; primero los que comparten cuenca. */
function neighborFacts(scope: SituationScope, inputs: SituationInputs, context: SignalContext): SituationFacts['cantonesVecinosConSeniales'] {
  const { analysis, stations } = inputs;
  if (!analysis) return null;
  const inside: ParishPoint[] = [];
  const outside: Array<[string, { canton: string; province: string; points: ParishPoint[] }]> = [];
  for (const [code, place] of context.places) {
    if (scope.includes({ cantonCode: code, province: place.province })) inside.push(...place.points);
    else outside.push([code, place]);
  }
  // Todo el país (o nada) queda dentro: no hay vecinos que mirar.
  if (inside.length === 0 || outside.length === 0) return null;
  const ownBasins = new Set(inside.flatMap((parish) => context.basins.get(parish.cantonCode) ?? []));
  const near = (point: ParishPoint) => {
    const cos = Math.cos((point.lat * Math.PI) / 180);
    return inside.some((own) => Math.hypot((own.lng - point.lng) * cos, own.lat - point.lat) * KM_PER_DEGREE <= NEIGHBOR_KM);
  };
  const high = new Map<string, ParishAlert[]>();
  for (const parish of analysis.parishes) {
    if (parish.semaphore !== 'red' && parish.semaphore !== 'orange') continue;
    high.set(parish.cantonCode, [...(high.get(parish.cantonCode) ?? []), parish]);
  }
  return outside
    .filter(([, place]) => place.points.some(near))
    .flatMap(([code, place]) => {
      const alerts = high.get(code) ?? [];
      const rain = topRain(alerts);
      const signals = [
        ...(alerts.length > 0 ? [`${amount(alerts.length, 'parroquia', 'parroquias')} en alerta alta o muy alta por lluvia${rain ? `, hasta ${rain}` : ''}`] : []),
        ...signalsOf(code, context, stations?.windowHours ?? 24),
      ];
      if (signals.length === 0) return [];
      const basin = context.basins.get(code);
      return [{ canton: place.canton, provincia: place.province, cuencaCompartida: basin && ownBasins.has(basin) ? basin : null, seniales: signals }];
    })
    .sort((a, b) => Number(b.cuencaCompartida !== null) - Number(a.cuencaCompartida !== null) || b.seniales.length - a.seniales.length)
    .slice(0, TOP_NEIGHBORS);
}

/** Los episodios anteriores de El Niño, solo si en el lugar se prevé una lluvia excepcional. */
function ninoFacts(scope: SituationScope, { analysis, sea }: SituationInputs): Pick<SituationFacts, 'comparacionConNiniosAnteriores'> {
  const exceptional = (analysis?.parishes ?? []).some(
    (parish) => scope.includes(parish) && (parish.category === 'extrema' || (parish.forecast.mm24h ?? 0) >= EXCEPTIONAL_RAIN_24H_MM),
  );
  if (!exceptional) return {};
  const today = sea?.nino12Anomaly ?? null;
  return {
    comparacionConNiniosAnteriores: {
      motivo: `Se prevé una lluvia excepcional (categoría extrema, o ${EXCEPTIONAL_RAIN_24H_MM} mm o más en 24 horas).`,
      calentamientoDelMarHoyC: today,
      fechaDelDatoDelMar: sea && today !== null ? dateFormat.format(new Date(sea.time)) : null,
      episodiosAnteriores: PAST_NINOS,
      lectura: seaReading(today),
      advertencia:
        'Se compara el calentamiento del mar (dato diario de hoy frente al mes más cálido de cada episodio), no la lluvia: el sistema no tiene la lluvia diaria de esos años. Sirve de referencia de la magnitud, no anuncia los mismos daños.',
    },
  };
}

/** Inundaciones que la SNGR reportó en el lugar durante el periodo guardado y dónde se repiten. */
function historyFacts(scope: SituationScope, context: SignalContext): SituationFacts['historialDeInundaciones'] {
  if (!context.historySince) return null;
  const rows = [...context.history.entries()].filter(([code, row]) => scope.includes({ cantonCode: code, province: row.province }));
  return {
    fuente: 'SNGR',
    desde: dateFormat.format(context.historySince),
    total: rows.reduce((sum, [, row]) => sum + row.count, 0),
    cantonesConMasInundaciones: rows
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, TOP_CANTONS)
      .map(([code, row]) => ({ canton: context.places.get(code)?.canton ?? code, provincia: row.province, inundaciones: row.count })),
  };
}

/** Bases del plan: las acciones que el documento de umbrales asigna a la categoría más alta y los recursos que hay. */
function planFacts(
  forecast: SituationFacts['pronosticoDeLluvia'],
  vulnerability: SituationFacts['vulnerabilidadYPreparacion'],
  neighbors: SituationFacts['cantonesVecinosConSeniales'],
): SituationFacts['basesDelPlanDeContingencia'] {
  const band = RAIN_BANDS.find((item) => item.label.toLowerCase() === forecast?.categoriaDeLluviaMasAlta) ?? RAIN_BANDS[0];
  const p = vulnerability?.preparacion;
  return {
    accionesSegunLaCategoriaDeLluviaMasAlta: forecast ? band.actions : 'No disponible: no se pudo leer el pronóstico.',
    recursosDelLugar: p
      ? [
          ...(p.alojamientosTemporales > 0 ? [amount(p.alojamientosTemporales, 'alojamiento temporal', 'alojamientos temporales')] : []),
          ...(p.campamentosViales > 0 ? [amount(p.campamentosViales, 'campamento vial', 'campamentos viales')] : []),
          ...(p.equiposDeMaquinariaPesada > 0 ? [amount(p.equiposDeMaquinariaPesada, 'equipo de maquinaria pesada', 'equipos de maquinaria pesada')] : []),
          ...(p.accionesPreventivasRealizadas > 0 ? [amount(p.accionesPreventivasRealizadas, 'acción preventiva ya realizada en vías', 'acciones preventivas ya realizadas en vías')] : []),
          ...(p.obrasVialesEnEjecucion > 0 ? [amount(p.obrasVialesEnEjecucion, 'obra vial en ejecución', 'obras viales en ejecución')] : []),
        ]
      : [],
    provinciasVecinasConLasQueCoordinar: [...new Set((neighbors ?? []).map(({ provincia }) => provincia))],
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

/** Lo que hay en los cantones con más parroquias en alerta: otras señales, antecedentes, lo expuesto, las vías y los recursos. */
function alertCantonFacts(scope: SituationScope, inputs: SituationInputs, context: SignalContext): SituationFacts['cantonesConParroquiasEnAlerta'] {
  const { analysis, stations } = inputs;
  if (!analysis?.forecast24h) return [];
  const inScope = analysis.parishes.filter((parish) => scope.includes(parish));
  // Alta o muy alta; si no hay ninguna, los cantones con alerta moderada.
  const anyHigh = inScope.some(({ semaphore }) => semaphore === 'red' || semaphore === 'orange');
  const counted = inScope.filter(({ semaphore }) => (anyHigh ? semaphore === 'red' || semaphore === 'orange' : semaphore === 'yellow'));
  const byCanton = new Map<string, { red: number; parishes: ParishAlert[] }>();
  for (const parish of counted) {
    const row = byCanton.get(parish.cantonCode) ?? { red: 0, parishes: [] };
    row.parishes.push(parish);
    if (parish.semaphore === 'red') row.red += 1;
    byCanton.set(parish.cantonCode, row);
  }
  const top = [...byCanton.entries()].sort(([, a], [, b]) => b.red - a.red || b.parishes.length - a.parishes.length).slice(0, TOP_CANTONS);

  const km = (value: number | null | undefined) => (value && value >= 1 ? Math.round(value) : 0);
  const listed = (items: Array<[number | null | undefined, string, string]>) =>
    items.flatMap(([value, one, many]) => (value && Math.round(value) > 0 ? [amount(Math.round(value), one, many)] : []));
  return top.map(([code, row]) => {
    const canton = context.details.get(code);
    const signals = signalsOf(code, context, stations?.windowHours ?? 24);
    const first = row.parishes[0];
    const past = context.history.get(code)?.count ?? 0;
    const bridges = canton?.exposed.bridges ?? 0;
    return {
      canton: first.canton,
      provincia: first.province,
      cuenca: context.basins.get(code) ?? null,
      parroquiasEnAlerta: row.parishes.length,
      nivelDeAlertaMasAlto: LEVEL_LABELS[first.semaphore],
      lluviaMasAltaEsperada: topRain(row.parishes),
      senialesQueCoinciden: signals,
      respaldoDeLaAlerta:
        signals.length === 0 ? 'señal aislada: solo el pronóstico de lluvia' : signals.length === 1 ? 'reforzada por otra señal' : 'reforzada por varias señales',
      antecedentesDeInundacion: [
        ...(past > 0 && context.historySince
          ? [`${amount(past, 'inundación reportada', 'inundaciones reportadas')} por la SNGR desde el ${dateFormat.format(context.historySince)}`]
          : []),
        ...(km(canton?.exposed.floodHistoryKm2) > 0
          ? [`${km(canton?.exposed.floodHistoryKm2)} km² donde el satélite ha visto agua de forma ocasional o frecuente entre 1999 y 2020 (zonas propensas a inundarse)`]
          : []),
      ],
      expuesto: listed([
        [canton?.exposed.floodTowns, 'población propensa a inundaciones', 'poblaciones propensas a inundaciones'],
        [canton?.exposed.schoolsHighFlood, 'institución educativa con susceptibilidad alta a inundación', 'instituciones educativas con susceptibilidad alta a inundación'],
        [canton?.exposed.healthFloodSusceptible, 'centro de salud susceptible a inundación', 'centros de salud susceptibles a inundación'],
      ]),
      redVial: [
        ...listed([
          [canton?.exposed.rveKm, 'km de red vial estatal', 'km de red vial estatal'],
          [canton?.exposed.rveCautionKm, 'km donde se circula con precaución', 'km donde se circula con precaución'],
          [canton?.triggers.criticalPoints, 'punto crítico en la red vial estatal', 'puntos críticos en la red vial estatal'],
        ]),
        ...(bridges > 0
          ? [`${amount(bridges, 'puente registrado', 'puentes registrados')}, ${canton?.exposed.bridgesBad ? `${canton.exposed.bridgesBad} en mal estado` : 'ninguno en mal estado'}`]
          : []),
        ...listed([
          [canton?.response.roadClosuresOpen, 'novedad vial abierta (cierre o paso restringido)', 'novedades viales abiertas (cierres o pasos restringidos)'],
          [canton?.response.roadEventsOpen, 'evento abierto en vías', 'eventos abiertos en vías'],
        ]),
      ],
      deslizamientos: [
        ...(km(canton?.exposed.landslideKm2) > 0 ? [`${km(canton?.exposed.landslideKm2)} km² con susceptibilidad muy alta a deslizamientos`] : []),
        ...listed([[canton?.exposed.schoolsLandslide, 'institución educativa en zona susceptible a deslizamientos', 'instituciones educativas en zonas susceptibles a deslizamientos']]),
      ],
      recursos: listed([
        [canton?.response.shelters, 'alojamiento temporal', 'alojamientos temporales'],
        [canton?.response.camps, 'campamento vial', 'campamentos viales'],
        [canton?.preventive.actions, 'acción preventiva ya realizada en vías', 'acciones preventivas ya realizadas en vías'],
      ]),
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
  /** Suma de un dato que puede faltar: null si la capa no se leyó. */
  const optionalSum = (value: (canton: CantonRow) => number | null | undefined) =>
    cantons.some((canton) => value(canton) === null || value(canton) === undefined) ? null : sum((canton) => value(canton) ?? 0);
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
      novedadesVialesAbiertas: optionalSum((canton) => canton.response.roadClosuresOpen),
      kmCuadradosConSusceptibilidadMuyAltaADeslizamientos: optionalSum((canton) => canton.exposed.landslideKm2),
      kmCuadradosQueSeHanInundadoAntes: optionalSum((canton) => canton.exposed.floodHistoryKm2),
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
  now: Date,
  missing: string[],
): SituationFacts['inundacionesReportadas'] {
  if (!events) {
    missing.push('Eventos de la SNGR');
    return null;
  }
  const placeOf = eventPlacer(parishPoints);
  const since = now.getTime() - EVENT_HOURS * 60 * 60 * 1000;
  const inScope = events.filter((event) => {
    if (event.occurredAt.getTime() < since) return false;
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
