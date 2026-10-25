import { BadGatewayException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { valueAt } from '../../common/raster/raster-grid.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { toTitleCase } from '../../common/text/title-case.js';
import { fetchArcgisLayer, type GeoJsonFeature } from '../../integrations/arcgis/arcgis-feature-layer.js';
import { EventsService } from '../events/events.service.js';
import { FloodHubService } from '../flood-hub/flood-hub.service.js';
import { HydrologyService } from '../hydrology/hydrology.service.js';
import { ObservedRainService } from '../observed-rain/observed-rain.service.js';
import { RainForecastService } from '../rain-forecast/rain-forecast.service.js';
import { RiskLayersService } from '../risk-layers/risk-layers.service.js';
import { WeatherStationsService } from '../weather-stations/weather-stations.service.js';
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
import { SEMAPHORE_RANK, classifyRain12h, type RainCategory, type Semaphore } from './rain-thresholds.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Las estaciones y el satélite traen un dato por hora: se recalcula cada hora, en segundo plano. */
const REFRESH_MS = HOUR_MS;
/** Primer cálculo poco después de arrancar, para que la primera consulta no lo espere. */
const FIRST_RUN_DELAY_MS = MINUTE_MS;
/** Ventana de lluvia del semáforo (documento "Lluvia de 12 horas"). */
const RAIN_WINDOW_HOURS = 12;
/** Una estación cuenta para el semáforo si informó al menos 9 de las 12 horas (si no, su suma se queda corta). */
const MIN_STATION_HOURS = 9;
/** Estaciones con lluvia (en la estación o en el satélite) necesarias para ajustar el satélite. */
const MIN_CORRECTION_PAIRS = 10;
/** Límites del factor de ajuste del satélite, por si un día raro lo dispara. */
const CORRECTION_RANGE = [0.1, 1.5] as const;
/** Eventos de la SNGR recientes que cuentan como detonante. */
const RECENT_EVENTS_MS = 72 * HOUR_MS;
/** Días del pronóstico de caudales que se miran (hoy y mañana). */
const RIVER_ALERT_DAYS = 2;

/** Cantones del Ecuador (INEC, DPA 2012), simplificados a ~100 m: 224 polígonos, ~1,4 MB. */
const CANTONS_LAYER_URL =
  'https://services7.arcgis.com/iFGeGXTAJXnjq0YN/arcgis/rest/services/Cantones_del_Ecuador/FeatureServer/0';

export type RainBasis = 'station' | 'satellite' | 'none';

export interface StationReading {
  code: string;
  name: string;
  mm: number;
  hoursWithData: number;
  lastTime: string | null;
}

export interface CantonAnalysis {
  code: string;
  name: string;
  province: string;
  /** Centro del recuadro del cantón [lat, lng], para centrar el mapa. */
  center: [number, number];
  semaphore: Semaphore;
  category: RainCategory;
  categoryLabel: string;
  consequences: string;
  actions: string;
  /** Lluvia de 12 h que decide el semáforo (mm), o null si no hay dato. */
  rain12hMm: number | null;
  /** De dónde sale: pluviómetro del INAMHI o satélite (ajustado con las estaciones). */
  basis: RainBasis;
  triggers: {
    stations: StationReading[];
    /** Satélite en el cantón (percentil 90 de las celdas), sin ajustar, aunque haya estación. */
    satellite12hMm: number | null;
    /** Lo mismo multiplicado por el factor de ajuste con las estaciones (ver `satellite.correction`). */
    satellite12hAdjustedMm: number | null;
    /** Pronóstico WRF de las próximas 24 h en el cantón (percentil 90). */
    forecast24hMm: number | null;
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
  /** Contorno simplificado (solo para los cantones en amarillo o rojo), para resaltarlo en el mapa. */
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } | null;
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CantonAnalysisSnapshot {
  updatedAt: string;
  windowHours: number;
  /**
   * Ventana del satélite usada y su ajuste: factor = lluvia de las estaciones /
   * lluvia del satélite en esos mismos puntos y horas (null si hay pocas estaciones con lluvia).
   */
  satellite: { product: string; from: string; to: string; correction: { factor: number; pairs: number } | null } | null;
  forecastRun: string | null;
  counts: Record<Semaphore, number> & { stationCantons: number };
  /** Todos los cantones, del más al menos afectado. */
  cantons: CantonAnalysis[];
  sources: SourceStatus[];
}

type Counter = Map<string, number>;

/**
 * Análisis por cantón con la lluvia de 12 h: semáforo verde, amarillo o rojo
 * con los umbrales del documento de la SNGR, y por cantón sus factores
 * detonantes, elementos expuestos, acciones preventivas y herramientas para la
 * respuesta. Lo más creíble manda: si el cantón tiene un pluviómetro del INAMHI
 * con datos, su lluvia medida; si no, la del satélite de las mismas 12 h.
 */
@Injectable()
export class CantonAnalysisService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CantonAnalysisService.name);
  private readonly cantonsCache = new TtlCache<{ shapes: CantonShape[]; geometries: Map<string, GeoJsonFeature['geometry']> }>(
    24 * HOUR_MS,
    1,
  );
  private latest: CantonAnalysisSnapshot | null = null;
  private loading: Promise<CantonAnalysisSnapshot> | null = null;
  private refreshTimer?: NodeJS.Timeout;
  private firstRunTimer?: NodeJS.Timeout;

  constructor(
    private readonly stations: WeatherStationsService,
    private readonly observedRain: ObservedRainService,
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
    const { shapes, geometries } = await this.cantonsCache.get('all', () => this.loadCantons());
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

    const [stations, satellite, forecast, rivers, floodHub, events, layers] = await Promise.all([
      attempt('Estaciones del INAMHI', () => this.stations.snapshot(), (value) => `${value.stations.length} estaciones`),
      attempt(
        'Satélite (12 h)',
        async () => {
          const grid = await this.observedRain.recentGrid(RAIN_WINDOW_HOURS);
          if (!grid) throw new Error('ningún producto tiene 12 h recientes');
          return grid;
        },
        (value) => value.productName,
      ),
      attempt('Pronóstico WRF (24 h)', () => this.rainForecast.dailyGrid(1), (value) => `corrida ${value.run}`),
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

    // Estaciones con suficientes horas, por cantón.
    const stationsByCanton = new Map<string, StationReading[]>();
    for (const station of stations?.stations ?? []) {
      if (station.totalMm === null || station.hoursWithData < MIN_STATION_HOURS) continue;
      const canton = locator.locate(station.lng, station.lat);
      if (!canton) continue;
      const list = stationsByCanton.get(canton.code) ?? [];
      list.push({ code: station.code, name: station.name, mm: station.totalMm, hoursWithData: station.hoursWithData, lastTime: station.lastTime });
      stationsByCanton.set(canton.code, list);
    }

    // El satélite (PERSIANN, por infrarrojo) exagera los aguaceros: el 25/10/2026 marcó más que el
    // pluviómetro en 45 de 48 estaciones con lluvia (Huaquillas: 61 mm frente a 0,1). Se ajusta con
    // las estaciones de la misma ventana: suma de lo medido / suma del satélite en esos puntos.
    let correction: { factor: number; pairs: number } | null = null;
    if (satellite) {
      const pairs = (stations?.stations ?? []).flatMap((station) => {
        if (station.totalMm === null || station.hoursWithData < MIN_STATION_HOURS) return [];
        const estimated = valueAt(satellite.grid, station.lat, station.lng);
        return estimated !== null && (estimated >= 1 || station.totalMm >= 1) ? [[station.totalMm, estimated]] : [];
      });
      const estimatedTotal = pairs.reduce((sum, [, estimated]) => sum + estimated, 0);
      if (pairs.length >= MIN_CORRECTION_PAIRS && estimatedTotal > 0) {
        const raw = pairs.reduce((sum, [measured]) => sum + measured, 0) / estimatedTotal;
        const factor = Math.min(CORRECTION_RANGE[1], Math.max(CORRECTION_RANGE[0], raw));
        correction = { factor: Math.round(factor * 100) / 100, pairs: pairs.length };
      }
    }

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
      const readings = (stationsByCanton.get(canton.code) ?? []).sort((a, b) => b.mm - a.mm);
      const satellite12h = satellite ? round1(zonalP90(satellite.grid, canton)) : null;
      const satelliteAdjusted = satellite12h === null ? null : round1(satellite12h * (correction?.factor ?? 1));
      const forecast24h = forecast ? round1(zonalP90(forecast.grid, canton)) : null;
      const basis: RainBasis = readings.length ? 'station' : satelliteAdjusted !== null ? 'satellite' : 'none';
      const rain = readings.length ? readings[0].mm : satelliteAdjusted;
      const band = classifyRain12h(rain ?? 0);
      const [west, south, east, north] = canton.bbox;
      const river = riverAlerts.get(canton.code);
      return {
        code: canton.code,
        name: canton.name,
        province: canton.province,
        center: [(south + north) / 2, (west + east) / 2],
        semaphore: band.semaphore,
        category: band.category,
        categoryLabel: band.label,
        consequences: band.consequences,
        actions: band.actions,
        rain12hMm: rain,
        basis,
        triggers: {
          stations: readings,
          satellite12hMm: satellite12h,
          satellite12hAdjustedMm: satelliteAdjusted,
          forecast24hMm: forecast24h,
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
        geometry: band.semaphore === 'green' ? null : (geometries.get(canton.code) as CantonAnalysis['geometry']),
      };
    });

    // Del más al menos afectado: semáforo; dentro de cada color, primero lo medido por estaciones
    // (lo más creíble), luego la lluvia y los ríos en alerta.
    const basisRank: Record<RainBasis, number> = { station: 2, satellite: 1, none: 0 };
    cantons.sort(
      (a, b) =>
        SEMAPHORE_RANK[b.semaphore] - SEMAPHORE_RANK[a.semaphore] ||
        basisRank[b.basis] - basisRank[a.basis] ||
        (b.rain12hMm ?? -1) - (a.rain12hMm ?? -1) ||
        b.triggers.riverAlerts - a.triggers.riverAlerts,
    );

    this.logger.log(`Análisis por cantón listo en ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return {
      updatedAt: new Date().toISOString(),
      windowHours: RAIN_WINDOW_HOURS,
      satellite: satellite ? { product: satellite.productName, from: satellite.from, to: satellite.to, correction } : null,
      forecastRun: forecast?.run ?? null,
      counts: {
        red: cantons.filter((canton) => canton.semaphore === 'red').length,
        yellow: cantons.filter((canton) => canton.semaphore === 'yellow').length,
        green: cantons.filter((canton) => canton.semaphore === 'green').length,
        stationCantons: stationsByCanton.size,
      },
      cantons,
      sources,
    };
  }

  private async loadCantons() {
    const { features } = await fetchArcgisLayer(CANTONS_LAYER_URL, {
      fields: ['DPA_CANTON', 'DPA_DESCAN', 'DPA_DESPRO', 'TOTPOP'],
      maxAllowableOffset: 0.001,
    });
    const geometries = new Map<string, GeoJsonFeature['geometry']>();
    const shapes = features.flatMap((feature): CantonShape[] => {
      const rings = ringsOf(feature.geometry);
      const code = String(feature.properties.DPA_CANTON ?? '').trim();
      if (!rings.length || !code) return [];
      geometries.set(code, feature.geometry);
      const population = Number(feature.properties.TOTPOP);
      return [
        {
          code,
          name: toTitleCase(feature.properties.DPA_DESCAN),
          province: toTitleCase(feature.properties.DPA_DESPRO),
          population: Number.isFinite(population) && population > 0 ? population : null,
          rings,
          bbox: bboxOf(rings),
        },
      ];
    });
    if (shapes.length === 0) throw new UpstreamError('ArcGIS', 'la capa de cantones llegó vacía');
    return { shapes, geometries };
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

