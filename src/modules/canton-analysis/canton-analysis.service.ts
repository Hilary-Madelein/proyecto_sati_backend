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
  zonalP90,
  type CantonShape,
} from './canton-geometry.js';
import {
  SEMAPHORE_RANK,
  classifyRain,
  classifyRain12h,
  classifyRain24h,
  type RainCategory,
  type RainWindow,
  type Semaphore,
} from './rain-thresholds.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Las estaciones y el satélite traen un dato por hora: se recalcula cada hora, en segundo plano. */
const REFRESH_MS = HOUR_MS;
/** Primer cálculo poco después de arrancar, para que la primera consulta no lo espere. */
const FIRST_RUN_DELAY_MS = MINUTE_MS;
/** Ventanas del semáforo, contadas desde ahora (pasos de 3 h del WRF): manda la más alta de las dos. */
const FORECAST_SHORT_HOURS = 12;
const FORECAST_LONG_HOURS = 24;
/** Eventos de la SNGR recientes que cuentan como detonante. */
const RECENT_EVENTS_MS = 72 * HOUR_MS;
/** Días del pronóstico de caudales que se miran (hoy y mañana). */
const RIVER_ALERT_DAYS = 2;

/** Cantones del Ecuador (INEC, DPA 2012), simplificados a ~100 m: 224 polígonos, ~1,4 MB. */
const CANTONS_LAYER_URL =
  'https://services7.arcgis.com/iFGeGXTAJXnjq0YN/arcgis/rest/services/Cantones_del_Ecuador/FeatureServer/0';

export interface CantonAnalysis {
  code: string;
  name: string;
  province: string;
  /** Región del INEC (Costa, Sierra, Amazonía, Región Insular). */
  region: string | null;
  /** Centro del recuadro del cantón [lat, lng], para centrar el mapa. */
  center: [number, number];
  semaphore: Semaphore;
  category: RainCategory;
  categoryLabel: string;
  consequences: string;
  actions: string;
  /**
   * Lluvia pronosticada por el WRF en el cantón (percentil 90 de sus celdas): próximas 12 y 24 h, desde ahora,
   * y la categoría de cada ventana con sus umbrales (el cantón toma la más alta de las dos).
   */
  forecast: {
    mm12h: number | null;
    mm24h: number | null;
    category12h: RainCategory | null;
    category24h: RainCategory | null;
  };
  /** Ventana que decidió el color (S = máx(S12h, S24h)); null si no hay pronóstico. */
  decidedBy: RainWindow | null;
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
    machinery: number;
    machineryOperational: number;
    camps: number;
    /** Eventos adversos en vías con acciones por ejecutar o en ejecución. */
    roadEventsOpen: number;
    /** Trabajos para recuperar la transitabilidad registrados. */
    recoveryWorks: number;
  };
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
  /** Cantones por color; los sin pronóstico van aparte (`noData`), no como verdes. */
  counts: Record<Semaphore, number> & { noData: number };
  /** Todos los cantones, del más al menos afectado. */
  cantons: CantonAnalysis[];
  sources: SourceStatus[];
}

type Counter = Map<string, number>;

/**
 * Análisis por cantón con la lluvia PRONOSTICADA (WRF) de las próximas 12 y 24 h:
 * semáforo verde, amarillo o rojo con los umbrales del documento de la SNGR
 * (manda el más alto de los dos: S = máx(S12h, S24h)), y por cantón sus factores
 * detonantes, elementos expuestos, acciones preventivas y herramientas para la
 * respuesta. Es un sistema de pronóstico: la lluvia ya medida no entra.
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
  private latest: CantonAnalysisSnapshot | null = null;
  private loading: Promise<CantonAnalysisSnapshot> | null = null;
  private refreshTimer?: NodeJS.Timeout;
  private firstRunTimer?: NodeJS.Timeout;

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
      .then((snapshot) => (this.latest = snapshot))
      .finally(() => (this.loading = null));
    return this.loading;
  }

  private refreshInBackground(): void {
    this.refresh().catch((error: unknown) => this.logger.warn(`No se pudo actualizar el análisis por cantón: ${(error as Error).message}`));
  }

  private async compute(): Promise<CantonAnalysisSnapshot> {
    const started = Date.now();
    const shapes = await this.cantonsCache.get('all', () => this.loadCantons());
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

    const [forecast, forecast12h, rivers, floodHub, events, layers] = await Promise.all([
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
      actions: countPoints(l.get('rve-preventive-works')),
      enosWorksActive: countPoints(l.get('el-nino-road-projects'), (f) => text(f, 'Estado_actual') === 'EN EJECUCIÓN'),
      culverts: countPoints(l.get('culverts-zone7')),
      shelters: countPoints(l.get('shelters')),
      sheltersActive: countPoints(l.get('shelters'), (f) => text(f, 'ESTADO') === 'ACTIVO'),
      machinery: countPoints(l.get('machinery')),
      machineryOperational: countPoints(l.get('machinery'), (f) => text(f, 'estado').startsWith('OPERATIVA')),
      camps: countPoints(l.get('mtop-camps')),
      roadEventsOpen: countPoints(l.get('road-adverse-events'), (f) =>
        ['ACCIONES POR EJECUTAR', 'ACCIONES EN EJECUCIÓN'].includes(text(f, 'situaci_n_del_evento')),
      ),
      recoveryWorks: countPoints(l.get('rve-recovery')),
    };
    const get = (counter: Counter, code: string, decimals = 0) => {
      const value = counter.get(code) ?? 0;
      return decimals ? Math.round(value * 10 ** decimals) / 10 ** decimals : value;
    };
    const round1 = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

    const cantons: CantonAnalysis[] = shapes.map((canton) => {
      const forecast24h = forecast ? round1(zonalP90(forecast.grid, canton)) : null;
      const forecast12hMm = forecast12h ? round1(zonalP90(forecast12h.grid, canton)) : null;
      const classified = classifyRain(forecast12hMm, forecast24h);
      const band = classified?.band ?? classifyRain12h(0);
      const [west, south, east, north] = canton.bbox;
      const river = riverAlerts.get(canton.code);
      return {
        code: canton.code,
        name: canton.name,
        province: canton.province,
        region: canton.region,
        center: [(south + north) / 2, (west + east) / 2],
        semaphore: band.semaphore,
        category: band.category,
        categoryLabel: band.label,
        consequences: band.consequences,
        actions: band.actions,
        forecast: {
          mm12h: forecast12hMm,
          mm24h: forecast24h,
          category12h: forecast12hMm === null ? null : classifyRain12h(forecast12hMm).category,
          category24h: forecast24h === null ? null : classifyRain24h(forecast24h).category,
        },
        decidedBy: classified?.decidedBy ?? null,
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
          machinery: get(counts.machinery, canton.code),
          machineryOperational: get(counts.machineryOperational, canton.code),
          camps: get(counts.camps, canton.code),
          roadEventsOpen: get(counts.roadEventsOpen, canton.code),
          recoveryWorks: get(counts.recoveryWorks, canton.code),
        },
      };
    });

    // Del más al menos afectado: semáforo; dentro de cada color, la lluvia que decidió el color y los ríos en alerta.
    const decisive = (canton: CantonAnalysis) =>
      (canton.decidedBy === '24h' ? canton.forecast.mm24h : canton.forecast.mm12h) ?? -1;
    cantons.sort(
      (a, b) =>
        SEMAPHORE_RANK[b.semaphore] - SEMAPHORE_RANK[a.semaphore] ||
        decisive(b) - decisive(a) ||
        b.triggers.riverAlerts - a.triggers.riverAlerts,
    );

    this.logger.log(`Análisis por cantón listo en ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return {
      updatedAt: new Date().toISOString(),
      forecastRun: forecast?.run ?? null,
      forecast12h: forecast12h ? { from: forecast12h.from, to: forecast12h.to } : null,
      forecast24h: forecast ? { from: forecast.from, to: forecast.to } : null,
      counts: {
        red: cantons.filter((canton) => canton.semaphore === 'red').length,
        yellow: cantons.filter((canton) => canton.semaphore === 'yellow').length,
        green: cantons.filter((canton) => canton.semaphore === 'green' && canton.decidedBy !== null).length,
        noData: cantons.filter((canton) => canton.decidedBy === null).length,
      },
      cantons,
      sources,
    };
  }

  private async loadCantons() {
    const { features } = await fetchArcgisLayer(CANTONS_LAYER_URL, {
      fields: ['DPA_CANTON', 'DPA_DESCAN', 'DPA_DESPRO', 'REN_REGION', 'TOTPOP'],
      maxAllowableOffset: 0.001,
    });
    const shapes = features.flatMap((feature): CantonShape[] => {
      const rings = ringsOf(feature.geometry);
      const code = String(feature.properties.DPA_CANTON ?? '').trim();
      if (!rings.length || !code) return [];
      const population = Number(feature.properties.TOTPOP);
      return [
        {
          code,
          name: toTitleCase(feature.properties.DPA_DESCAN),
          province: toTitleCase(feature.properties.DPA_DESPRO),
          region: feature.properties.REN_REGION ? toTitleCase(feature.properties.REN_REGION) : null,
          population: Number.isFinite(population) && population > 0 ? population : null,
          rings,
          bbox: bboxOf(rings),
        },
      ];
    });
    if (shapes.length === 0) throw new UpstreamError('ArcGIS', 'la capa de cantones llegó vacía');
    return shapes;
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
      'machinery',
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

