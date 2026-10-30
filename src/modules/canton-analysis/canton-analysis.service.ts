import { BadGatewayException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { toTitleCase } from '../../common/text/title-case.js';
import { fetchArcgisLayer, type GeoJsonFeature } from '../../integrations/arcgis/arcgis-feature-layer.js';
import { EventsService } from '../events/events.service.js';
import { FloodHubService } from '../flood-hub/flood-hub.service.js';
import { HydrologyService } from '../hydrology/hydrology.service.js';
import { RainForecastService } from '../rain-forecast/rain-forecast.service.js';
import { RiskLayersService } from '../risk-layers/risk-layers.service.js';
import {
  CantonLocator,
  anchorOf,
  bboxOf,
  distanceKm,
  ringsOf,
  segmentsOf,
  type CantonShape,
} from './canton-geometry.js';
import { loadParishes, parishRain, type ParishPoint, type ParishRain } from './parishes.js';
import {
  PREPAREDNESS_WEIGHTS,
  normalizeText,
  preparednessIndex,
  classifyRoadProjects,
  provinceCodeOf,
  type PreparednessIndicator,
  type ProvincePreparedness,
  type ProvinceResources,
} from './preparedness.js';
import { RISK_LAYERS } from '../risk-layers/risk-layers.catalog.js';
import { isPreventiveAction } from '../risk-layers/mit-actions.js';
import { RAIN_BANDS, SEMAPHORE_RANK, type Band, type Semaphore } from './rain-thresholds.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Las estaciones y el satélite traen un dato por hora: se recalcula cada hora, en segundo plano. */
const REFRESH_MS = HOUR_MS;
/** Primer cálculo poco después de arrancar, para que la primera consulta no lo espere. */
const FIRST_RUN_DELAY_MS = MINUTE_MS;
/** Bloques del WRF: las ventanas empiezan en el bloque en curso, así que cambian cada 3 h. */
const STEP_MS = 3 * HOUR_MS;
/** Recálculo poco después de empezar cada bloque (pasada la caché de 5 min de la ventana de lluvia). */
const NEXT_STEP_DELAY_MS = 6 * MINUTE_MS;
/** Ventanas del semáforo, contadas desde ahora (pasos de 3 h del WRF): manda la más alta de las dos. */
const FORECAST_SHORT_HOURS = 12;
const FORECAST_LONG_HOURS = 24;
/** Código DPA de las zonas no delimitadas (no son una provincia). */
const UNDEFINED_ZONE_CODE = '90';
/**
 * Cambios de provincia posteriores a la capa de cantones (DPA 2012), que la SNGR
 * y el MIT ya usan: La Concordia pasó de Esmeraldas a Santo Domingo de los
 * Tsáchilas (consulta popular de 2012) y Manga del Cura, zona no delimitada, a
 * Manabí (consulta popular de 2015).
 */
const PROVINCE_UPDATES: Record<string, string> = { '0808': '23', '9003': '13' };
/** Cantón de la capa de cantones (DPA 2012) con otro código en las parroquias del CONALI 2023: La Concordia. */
const CANTON_CODE_ALIASES: Record<string, string> = { '2302': '0808' };
/** Eventos de la SNGR recientes que cuentan como detonante. */
const RECENT_EVENTS_MS = 72 * HOUR_MS;
/**
 * Eventos en vías sin atender que cuentan: los de los últimos meses (el servicio
 * guarda eventos desde 2015, y los viejos suelen quedar abiertos sin actualizar).
 */
const ROAD_EVENTS_MONTHS = 3;
/** Días del pronóstico de caudales que se miran (hoy y mañana). */
const RIVER_ALERT_DAYS = 2;

/** Cantones del Ecuador (INEC, DPA 2012), simplificados a ~100 m: 224 polígonos, ~1,4 MB. */
const CANTONS_LAYER_URL =
  'https://services7.arcgis.com/iFGeGXTAJXnjq0YN/arcgis/rest/services/Cantones_del_Ecuador/FeatureServer/0';
/**
 * Provincias con los límites oficiales del CONALI (DPA 2018), publicadas por la
 * SNGR: área de cada provincia en km² (AREA). No trae Galápagos.
 */
const PROVINCES_LAYER_URL = 'https://services8.arcgis.com/csQLKpeoUQumugVg/arcgis/rest/services/Provincias/FeatureServer/1';

export interface CantonAnalysis {
  code: string;
  name: string;
  province: string;
  /** Región del INEC (Costa, Sierra, Amazonía, Región Insular). */
  region: string | null;
  /** Centro del recuadro del cantón [lat, lng], para centrar el mapa. */
  center: [number, number];
  triggers: {
    /** Tramos de río con alerta hoy o mañana (sin los que el modelo sobrestima siempre). */
    riverAlerts: number;
    /** Mayor periodo de retorno superado en esos tramos (años), 0 si ninguno. */
    riverMaxLevel: number;
    floodHubFlagged: number;
    /** Inundaciones reportadas por la SNGR en las últimas 72 h. */
    sngrEvents: number;
    criticalPoints: number;
  };
  exposed: {
    /** Población de la capa de cantones (la fuente no indica año ni origen). */
    population: number | null;
    schools: number;
    schoolsHighFlood: number;
    students: number;
    healthCenters: number;
    healthFloodSusceptible: number;
    rveKm: number;
    rveCautionKm: number;
    bridges: number;
    bridgesBad: number;
    floodTowns: number;
  };
  preventive: {
    actions: number;
    enosWorksActive: number;
    culverts: number;
  };
  response: {
    shelters: number;
    sheltersActive: number;
    /** Maquinaria pesada del MIT en la provincia del cantón (el inventario es por provincia). */
    provinceMachinery: number;
    camps: number;
    /** Eventos adversos en vías de los últimos 3 meses con acciones por ejecutar o en ejecución. */
    roadEventsOpen: number;
    /** Trabajos para recuperar la transitabilidad registrados. */
    recoveryWorks: number;
  };
}

/** Alerta de una parroquia: el pronóstico en su punto, clasificado con los umbrales del documento. */
export interface ParishAlert extends ParishRain {
  /** Código DPA de 6 dígitos (CONALI 2023). */
  code: string;
  name: string;
  canton: string;
  /** Código del cantón en `cantons`, con sus detonantes, elementos expuestos y recursos. */
  cantonCode: string;
  province: string;
  kind: ParishPoint['kind'];
  /** Punto de la parroquia [lat, lng], dentro de su territorio: ahí se lee el pronóstico. */
  point: [number, number];
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CantonAnalysisSnapshot {
  updatedAt: string;
  forecastRun: string | null;
  /** Ventanas del pronóstico usadas (null si la corrida no las tenía). */
  forecast12h: { from: string; to: string } | null;
  forecast24h: { from: string; to: string } | null;
  /** Parroquias por nivel; las sin pronóstico van aparte (`noData`), no como verdes. */
  counts: Record<Semaphore, number> & { noData: number };
  /** Todas las parroquias con pronóstico, de la más a la menos afectada (el visor elige qué niveles muestra). */
  parishes: ParishAlert[];
  /** Los cantones con sus detonantes, elementos expuestos y recursos (sin nivel de alerta propio), por nombre. */
  cantons: CantonAnalysis[];
  /** Tabla del documento (categorías, umbrales, nivel, consecuencias y acciones), para la leyenda. */
  bands: readonly Band[];
  /** Índice de preparación de las 24 provincias (ISPP-FEN, ver preparedness.ts), de la más a la menos preparada. */
  provinces: ProvincePreparedness[];
  /** Peso de cada indicador en el índice (suman 1). */
  preparednessWeights: Record<PreparednessIndicator, number>;
  sources: SourceStatus[];
}

type Counter = Map<string, number>;

/**
 * Alerta de inundación por parroquia con la lluvia PRONOSTICADA (WRF) de las
 * próximas 12 y 24 h: el valor de la celda donde cae el punto de cada parroquia,
 * tal cual (la lluvia intensa es puntual: no se promedia ni se toma un percentil),
 * con los umbrales del documento de la SNGR (manda el más alto de los dos: S =
 * máx(S12h, S24h)). Por cantón, sus factores detonantes, elementos expuestos,
 * acciones preventivas y herramientas para la respuesta. Es un sistema de
 * pronóstico: la lluvia ya medida no entra.
 *
 * Nota: con los umbrales del documento el WRF pinta más cantones de los que
 * después llueven (calibración del 25/10/2026 con el archivo de lluvia: 60 % en
 * amarillo o más y 13 % en rojo, frente a 29 % y 5 % medidos; y la lluvia
 * fuerte acierta poco). Se usan igual porque son los de la metodología.
 */
@Injectable()
export class CantonAnalysisService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CantonAnalysisService.name);
  // Los contornos no viajan en la respuesta: el visor tiene los suyos (archivo fijo) y los une por el código DPA.
  private readonly cantonsCache = new TtlCache<CantonShape[]>(24 * HOUR_MS, 1);
  private parishes: Promise<ParishPoint[]> | null = null;
  private latest: CantonAnalysisSnapshot | null = null;
  private loading: Promise<CantonAnalysisSnapshot> | null = null;
  private refreshTimer?: NodeJS.Timeout;
  private firstRunTimer?: NodeJS.Timeout;
  private nextStepTimer?: NodeJS.Timeout;

  constructor(
    private readonly rainForecast: RainForecastService,
    private readonly hydrology: HydrologyService,
    private readonly floodHub: FloodHubService,
    private readonly events: EventsService,
    private readonly riskLayers: RiskLayersService,
  ) {}

  onApplicationBootstrap(): void {
    this.firstRunTimer = setTimeout(() => this.refreshInBackground(), FIRST_RUN_DELAY_MS);
    this.refreshTimer = setInterval(() => this.refreshInBackground(), REFRESH_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.firstRunTimer);
    clearInterval(this.refreshTimer);
    clearTimeout(this.nextStepTimer);
  }

  /** La última carga al instante; solo la primera consulta tras arrancar espera el cálculo. */
  async snapshot(): Promise<CantonAnalysisSnapshot> {
    if (this.latest) {
      if (Date.now() - Date.parse(this.latest.updatedAt) > REFRESH_MS) this.refreshInBackground();
      return this.latest;
    }
    try {
      return await this.refresh();
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  private refresh(): Promise<CantonAnalysisSnapshot> {
    this.loading ??= this.compute()
      .then((snapshot) => {
        this.latest = snapshot;
        this.scheduleNextStep(snapshot);
        return snapshot;
      })
      .finally(() => (this.loading = null));
    return this.loading;
  }

  /**
   * Las 12 y 24 h se cuentan desde el bloque de 3 h en curso: al empezar el
   * siguiente se recalcula, sin esperar al cálculo de cada hora.
   */
  private scheduleNextStep(snapshot: CantonAnalysisSnapshot): void {
    clearTimeout(this.nextStepTimer);
    const from = snapshot.forecast12h?.from;
    if (!from) return;
    const delay = Date.parse(from) + STEP_MS + NEXT_STEP_DELAY_MS - Date.now();
    if (delay > 0) this.nextStepTimer = setTimeout(() => this.refreshInBackground(), delay);
  }

  private refreshInBackground(): void {
    this.refresh().catch((error: unknown) => this.logger.warn(`No se pudo actualizar el análisis por cantón: ${(error as Error).message}`));
  }

  private async compute(): Promise<CantonAnalysisSnapshot> {
    const started = Date.now();
    const shapes = await this.cantonsCache.get('all', () => this.loadCantons());
    this.parishes ??= loadParishes();
    const parishPoints = await this.parishes;
    const locator = new CantonLocator(shapes);
    const sources: SourceStatus[] = [];
    /** Corre una fuente; si falla, el análisis sigue sin ella y queda anotado. */
    const attempt = async <T>(name: string, load: () => Promise<T>, detail: (value: T) => string): Promise<T | null> => {
      try {
        const value = await load();
        sources.push({ name, ok: true, detail: detail(value) });
        return value;
      } catch (error) {
        sources.push({ name, ok: false, detail: (error as Error).message });
        return null;
      }
    };

    /** Lluvia pronosticada de las próximas `hours` horas (pasos de 3 h del WRF). */
    const forecastWindow = (hours: number) =>
      attempt(
        `Pronóstico WRF (${hours} h)`,
        async () => {
          const grid = await this.rainForecast.nextHoursGrid(hours);
          if (!grid) throw new Error(`la corrida no tiene las próximas ${hours} h`);
          return grid;
        },
        (value) => `${value.from} a ${value.to}`,
      );

    const [forecast, forecast12h, rivers, floodHub, events, layers, preparedness] = await Promise.all([
      forecastWindow(FORECAST_LONG_HOURS),
      forecastWindow(FORECAST_SHORT_HOURS),
      attempt('Alertas por caudal', () => this.hydrology.getAlerts(), (value) => `${value.alerts.length} tramos`),
      attempt('Google Flood Hub', () => this.floodHub.snapshot(), (value) => `${value.flaggedCount} con aviso`),
      attempt(
        'Eventos SNGR (72 h)',
        async () =>
          (await this.events.list({ from: new Date(Date.now() - RECENT_EVENTS_MS), to: new Date() }, { limit: 1000, offset: 0 })).items,
        (value) => `${value.length} eventos`,
      ),
      this.loadRiskLayers(sources),
      attempt(
        'Índice de preparación',
        () => this.loadPreparedness(shapes),
        (value) => `${value.length} provincias`,
      ),
    ]);

    const countPoints = (features: readonly GeoJsonFeature[] | undefined, include: (feature: GeoJsonFeature) => boolean = () => true) => {
      const counter: Counter = new Map();
      for (const feature of features ?? []) {
        if (!include(feature)) continue;
        const anchor = anchorOf(feature.geometry);
        const canton = anchor && locator.locate(anchor[0], anchor[1]);
        if (canton) counter.set(canton.code, (counter.get(canton.code) ?? 0) + 1);
      }
      return counter;
    };
    const sumPoints = (features: readonly GeoJsonFeature[] | undefined, value: (feature: GeoJsonFeature) => number) => {
      const counter: Counter = new Map();
      for (const feature of features ?? []) {
        const anchor = anchorOf(feature.geometry);
        const canton = anchor && locator.locate(anchor[0], anchor[1]);
        if (canton) counter.set(canton.code, (counter.get(canton.code) ?? 0) + value(feature));
      }
      return counter;
    };
    /** Km de líneas por cantón: cada tramo se asigna al cantón de su punto medio. */
    const lineKm = (features: readonly GeoJsonFeature[] | undefined, include: (feature: GeoJsonFeature) => boolean = () => true) => {
      const counter: Counter = new Map();
      for (const feature of features ?? []) {
        if (!include(feature)) continue;
        for (const [a, b] of segmentsOf(feature.geometry)) {
          const canton = locator.locate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          if (canton) counter.set(canton.code, (counter.get(canton.code) ?? 0) + distanceKm(a, b));
        }
      }
      return counter;
    };
    const roadEventsSince = new Date().setMonth(new Date().getMonth() - ROAD_EVENTS_MONTHS);
    const text = (feature: GeoJsonFeature, field: string) => String(feature.properties[field] ?? '').trim().toUpperCase();

    const riverAlerts = new Map<string, { count: number; max: number }>();
    for (const alert of rivers?.alerts ?? []) {
      if (alert.persistent) continue;
      const level = Math.max(0, ...alert.dailyLevels.slice(0, RIVER_ALERT_DAYS));
      if (level === 0) continue;
      const canton = locator.locate(alert.longitude, alert.latitude);
      if (!canton) continue;
      const current = riverAlerts.get(canton.code) ?? { count: 0, max: 0 };
      riverAlerts.set(canton.code, { count: current.count + 1, max: Math.max(current.max, level) });
    }
    const floodHubFlagged = countPoints(
      (floodHub?.gauges ?? [])
        .filter((gauge) => gauge.severity === 'above_normal' || gauge.severity === 'severe' || gauge.severity === 'extreme')
        .map((gauge) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [gauge.lng, gauge.lat] }, properties: {} })),
    );
    const sngrEvents = countPoints(
      (events ?? []).map((event) => ({ type: 'Feature', geometry: event.location, properties: {} }) as GeoJsonFeature),
    );

    const l = layers;
    const counts = {
      criticalPoints: countPoints(l.get('rve-critical-points')),
      schools: countPoints(l.get('schools')),
      schoolsHighFlood: countPoints(l.get('schools'), (f) => text(f, 'SUSCEPTIBI') === 'SUSCEPTIBILIDAD ALTA A INUNDACIONES'),
      students: sumPoints(l.get('schools'), (f) => Number(f.properties.ESTUDIANTE) || 0),
      healthCenters: countPoints(l.get('health-centers')),
      healthFloodSusceptible: countPoints(l.get('health-centers-floods')),
      rveKm: lineKm(l.get('rve')),
      rveCautionKm: lineKm(l.get('rve'), (f) => text(f, 'ESTADO') === 'CIRCULE CON PRECAUCIÓN'),
      bridges: countPoints(l.get('bridges')),
      bridgesBad: countPoints(l.get('bridges'), (f) => ['MALO', 'COLAPSADO'].includes(text(f, 'ESTADO'))),
      floodTowns: countPoints(l.get('flood-prone-towns')),
      // Realizadas: las que ya empezaron (no las planificadas).
      // Preventivas ya iniciadas (la capa también puede traer acciones de respuesta).
      actions: countPoints(
        l.get('rve-preventive-works'),
        (f) => isPreventiveAction(f.properties.tip_activid) && Date.parse(String(f.properties.fecha_inicio ?? '')) <= Date.now(),
      ),
      enosWorksActive: countPoints(l.get('el-nino-road-projects'), (f) => text(f, 'Estado_actual') === 'EN EJECUCIÓN'),
      culverts: countPoints(l.get('culverts-zone7')),
      shelters: countPoints(l.get('shelters')),
      sheltersActive: countPoints(l.get('shelters'), (f) => text(f, 'ESTADO') === 'ACTIVO'),
      camps: countPoints(l.get('mtop-camps')),
      roadEventsOpen: countPoints(
        l.get('road-adverse-events'),
        (f) =>
          ['ACCIONES POR EJECUTAR', 'ACCIONES EN EJECUCIÓN'].includes(text(f, 'situaci_n_del_evento')) &&
          Date.parse(String(f.properties.fecha_en_que_ocurri_el_evento ?? '')) >= roadEventsSince,
      ),
      recoveryWorks: countPoints(l.get('rve-recovery')),
    };
    // El inventario de maquinaria pone todos los equipos de una provincia en un mismo punto: se cuenta por la provincia que declara.
    const provinceCodes = new Map(shapes.map((canton) => [normalizeText(canton.province), canton.provinceCode]));
    const machineryByProvince: Counter = new Map();
    for (const { properties } of l.get('machinery-by-province') ?? []) {
      const code = provinceCodeOf(properties.DPA_DESPRO, provinceCodes);
      if (code) machineryByProvince.set(code, (machineryByProvince.get(code) ?? 0) + 1);
    }
    const get = (counter: Counter, code: string, decimals = 0) => {
      const value = counter.get(code) ?? 0;
      return decimals ? Math.round(value * 10 ** decimals) / 10 ** decimals : value;
    };
    const cantons: CantonAnalysis[] = shapes.map((canton) => {
      const [west, south, east, north] = canton.bbox;
      const river = riverAlerts.get(canton.code);
      return {
        code: canton.code,
        name: canton.name,
        province: canton.province,
        region: canton.region,
        center: [(south + north) / 2, (west + east) / 2],
        triggers: {
          riverAlerts: river?.count ?? 0,
          riverMaxLevel: river?.max ?? 0,
          floodHubFlagged: get(floodHubFlagged, canton.code),
          sngrEvents: get(sngrEvents, canton.code),
          criticalPoints: get(counts.criticalPoints, canton.code),
        },
        exposed: {
          population: canton.population,
          schools: get(counts.schools, canton.code),
          schoolsHighFlood: get(counts.schoolsHighFlood, canton.code),
          students: get(counts.students, canton.code),
          healthCenters: get(counts.healthCenters, canton.code),
          healthFloodSusceptible: get(counts.healthFloodSusceptible, canton.code),
          rveKm: get(counts.rveKm, canton.code, 1),
          rveCautionKm: get(counts.rveCautionKm, canton.code, 1),
          bridges: get(counts.bridges, canton.code),
          bridgesBad: get(counts.bridgesBad, canton.code),
          floodTowns: get(counts.floodTowns, canton.code),
        },
        preventive: {
          actions: get(counts.actions, canton.code),
          enosWorksActive: get(counts.enosWorksActive, canton.code),
          culverts: get(counts.culverts, canton.code),
        },
        response: {
          shelters: get(counts.shelters, canton.code),
          sheltersActive: get(counts.sheltersActive, canton.code),
          provinceMachinery: get(machineryByProvince, canton.provinceCode),
          camps: get(counts.camps, canton.code),
          roadEventsOpen: get(counts.roadEventsOpen, canton.code),
          recoveryWorks: get(counts.recoveryWorks, canton.code),
        },
      };
    });

    cantons.sort((a, b) => a.name.localeCompare(b.name, 'es'));

    const allParishes: ParishAlert[] = parishPoints.map((parish) => ({
      code: parish.code,
      name: parish.name,
      canton: parish.canton,
      cantonCode: CANTON_CODE_ALIASES[parish.cantonCode] ?? parish.cantonCode,
      province: parish.province,
      kind: parish.kind,
      point: [parish.lat, parish.lng],
      ...parishRain(parish, forecast12h?.grid ?? null, forecast?.grid ?? null),
    }));
    // De la más a la menos afectada: nivel y, dentro de cada uno, la lluvia que lo decidió.
    const decisive = (parish: ParishAlert) => (parish.decidedBy === '24h' ? parish.forecast.mm24h : parish.forecast.mm12h) ?? -1;
    const parishes = allParishes
      .filter((parish) => parish.decidedBy !== null)
      .sort((a, b) => SEMAPHORE_RANK[b.semaphore] - SEMAPHORE_RANK[a.semaphore] || decisive(b) - decisive(a));

    this.logger.log(`Análisis por parroquia listo en ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return {
      updatedAt: new Date().toISOString(),
      forecastRun: forecast?.run ?? null,
      forecast12h: forecast12h ? { from: forecast12h.from, to: forecast12h.to } : null,
      forecast24h: forecast ? { from: forecast.from, to: forecast.to } : null,
      counts: {
        red: allParishes.filter((parish) => parish.semaphore === 'red').length,
        orange: allParishes.filter((parish) => parish.semaphore === 'orange').length,
        yellow: allParishes.filter((parish) => parish.semaphore === 'yellow').length,
        green: allParishes.filter((parish) => parish.semaphore === 'green' && parish.decidedBy !== null).length,
        noData: allParishes.filter((parish) => parish.decidedBy === null).length,
      },
      parishes,
      cantons,
      bands: RAIN_BANDS,
      provinces: preparedness ?? [],
      preparednessWeights: PREPAREDNESS_WEIGHTS,
      sources,
    };
  }

  private async loadCantons() {
    const { features } = await fetchArcgisLayer(CANTONS_LAYER_URL, {
      fields: ['DPA_CANTON', 'DPA_DESCAN', 'DPA_DESPRO', 'REN_REGION', 'TOTPOP', 'AREA_KM2'],
      maxAllowableOffset: 0.001,
    });
    const shapes = features.flatMap((feature): CantonShape[] => {
      const rings = ringsOf(feature.geometry);
      const code = String(feature.properties.DPA_CANTON ?? '').trim();
      if (!rings.length || !code) return [];
      const population = Number(feature.properties.TOTPOP);
      const area = Number(feature.properties.AREA_KM2);
      return [
        {
          code,
          name: toTitleCase(feature.properties.DPA_DESCAN),
          provinceCode: code.slice(0, 2),
          province: toTitleCase(feature.properties.DPA_DESPRO),
          region: feature.properties.REN_REGION ? toTitleCase(feature.properties.REN_REGION) : null,
          population: Number.isFinite(population) && population > 0 ? population : null,
          areaKm2: Number.isFinite(area) && area > 0 ? area : null,
          rings,
          bbox: bboxOf(rings),
        },
      ];
    });
    if (shapes.length === 0) throw new UpstreamError('ArcGIS', 'la capa de cantones llegó vacía');
    const provinceNames = new Map(shapes.map((canton) => [canton.provinceCode, canton.province]));
    for (const canton of shapes) {
      const moved = PROVINCE_UPDATES[canton.code];
      const name = moved ? provinceNames.get(moved) : undefined;
      if (moved && name) Object.assign(canton, { provinceCode: moved, province: name });
    }
    return shapes;
  }

  /**
   * Índice de preparación por provincia (documento "Semaforización para componente
   * Preparación", con los pesos del equipo). Cada registro cuenta en la provincia que
   * declara la institución (no por su ubicación: puntos en límites o en cantones que
   * cambiaron de provincia caían en otra), y también los que no tienen ubicación.
   * Solo recursos efectivos: alojamientos calificados por la SNGR ("ACTIVO" es que ya
   * alojan gente), todos los campamentos del MIT (la capa no dice si operan), las
   * acciones preventivas ya empezadas y los proyectos viales en ejecución o
   * terminados (sin las obras que no son viales). Las alcantarillas limpiadas no
   * entran: solo hay registro de la Zona 7 y harían que Loja pese por todas.
   */
  private async loadPreparedness(shapes: readonly CantonShape[]): Promise<ProvincePreparedness[]> {
    // Provincias según sus cantones, con el área de estos como respaldo (abajo se reemplaza por la del CONALI).
    const provinces = new Map<string, ProvinceResources>();
    for (const canton of shapes) {
      const code = canton.provinceCode;
      if (code === UNDEFINED_ZONE_CODE) continue;
      const province = provinces.get(code) ?? { code, name: canton.province, counts: { shelters: 0, camps: 0, preventiveActions: 0, roadProjects: 0 }, areaKm2: 0, rveKm: 0 };
      province.areaKm2 += canton.areaKm2 ?? 0;
      provinces.set(code, province);
    }
    const codesByName = new Map([...provinces.values()].map((province) => [normalizeText(province.name), province.code]));

    const records = async (layerId: string, fields: string[], geometry = false) => {
      const layer = RISK_LAYERS.find((item) => item.id === layerId);
      if (layer?.source.kind !== 'arcgis') throw new Error(`la capa ${layerId} no es un servicio de ArcGIS`);
      return (await fetchArcgisLayer(layer.source.layerUrl, { fields, geometry })).features;
    };
    const [shelters, camps, actions, works, roads, officialAreas] = await Promise.all([
      records('shelters', ['PROVINCIA']),
      records('mtop-camps', ['DPA_DESPRO']),
      records('rve-preventive-works', ['despro', 'fecha_inicio', 'tip_activid']),
      // Con trazado: así se reconoce la misma obra cargada dos veces.
      records(
        'el-nino-road-projects',
        ['Nro', 'Provincia', 'Estado_actual', 'Accion_Esp', 'Join_Count', 'Presupuesto_tot', 'Total_Obra', 'Fecha_inicio', 'Porcentaje_avance'],
        true,
      ),
      records('rve', ['PROVINCIA', 'DISTANCIA_KM']),
      fetchArcgisLayer(PROVINCES_LAYER_URL, { fields: ['DPA_PROVIN', 'AREA'], geometry: false }).then((data) => data.features),
    ]);
    // Área oficial del CONALI; la provincia que no trae (Galápagos) queda con la suma de sus cantones.
    for (const { properties } of officialAreas) {
      const row = provinces.get(String(properties.DPA_PROVIN ?? ''));
      const area = Number(properties.AREA);
      if (row && Number.isFinite(area) && area > 0) row.areaKm2 = area;
    }

    let unassigned = 0;
    const add = (indicator: PreparednessIndicator, province: unknown) => {
      const code = provinceCodeOf(province, codesByName);
      const row = code ? provinces.get(code) : undefined;
      if (row) row.counts[indicator] += 1;
      else unassigned += 1;
    };
    for (const { properties } of shelters) add('shelters', properties.PROVINCIA);
    for (const { properties } of camps) add('camps', properties.DPA_DESPRO);
    for (const { properties } of actions) {
      if (isPreventiveAction(properties.tip_activid) && Date.parse(String(properties.fecha_inicio ?? '')) <= Date.now()) {
        add('preventiveActions', properties.despro);
      }
    }
    const categories = classifyRoadProjects(works);
    works.forEach(({ properties }, i) => {
      if (categories[i] === 'counted') add('roadProjects', properties.Provincia);
    });
    // Km de Red Vial Estatal de cada provincia, según la provincia de cada tramo (MIT).
    for (const { properties } of roads) {
      const code = provinceCodeOf(properties.PROVINCIA, codesByName);
      const row = code ? provinces.get(code) : undefined;
      const km = Number(properties.DISTANCIA_KM);
      if (row && Number.isFinite(km)) row.rveKm += km;
      else unassigned += 1;
    }
    if (unassigned > 0) this.logger.warn(`Índice de preparación: ${unassigned} registros sin provincia reconocible`);
    return preparednessIndex([...provinces.values()]);
  }

  /** Capas de exposición, preparación y respuesta; una que falle no impide usar las demás. */
  private async loadRiskLayers(sources: SourceStatus[]): Promise<Map<string, GeoJsonFeature[]>> {
    const ids = [
      'rve-critical-points',
      'schools',
      'health-centers',
      'health-centers-floods',
      'rve',
      'bridges',
      'flood-prone-towns',
      'rve-preventive-works',
      'el-nino-road-projects',
      'culverts-zone7',
      'shelters',
      'machinery-by-province',
      'mtop-camps',
      'road-adverse-events',
      'rve-recovery',
    ];
    const layers = new Map<string, GeoJsonFeature[]>();
    const failed: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          layers.set(id, (await this.riskLayers.get(id)).features);
        } catch {
          failed.push(id);
        }
      }),
    );
    sources.push({
      name: 'Capas de exposición y respuesta',
      ok: failed.length === 0,
      detail: failed.length ? `sin datos de: ${failed.join(', ')}` : `${ids.length} capas`,
    });
    return layers;
  }
}

