import { VectorTile } from '@mapbox/vector-tile';
import { Injectable, Logger } from '@nestjs/common';
import { PbfReader } from 'pbf';
import { tilesCovering, type BBox } from '../../common/geo/web-mercator.js';
import { fetchWithRetry } from '../../common/http/fetch-with-retry.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { toTitleCase } from '../../common/text/title-case.js';
import { toEcuadorDate } from '../../common/time/ecuador-time.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { AlertLevel, RiverAlert, RiverAlertsSnapshot } from '../../modules/hydrology/domain/river.js';
import { RiverAlertSource } from '../../modules/hydrology/river-sources.js';

const SERVICE = 'Hydroviewer INAMHI';
const SOURCE_NAME = 'mvt_hydroviewer_warnings_points';
const LAYER_NAME = 'hydroviewer_warnings_points';
/** Ecuador continental e insular. */
const ECUADOR_BBOX: BBox = [-92, -5.1, -75.1, 1.5];
/** Zoom bajo: pocas teselas (6) y los puntos conservan buena precisión (~0,003°). */
const ALERTS_ZOOM = 5;
/** Días hacia atrás para buscar el último pronóstico publicado. */
const MAX_DAYS_BACK = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const LEVELS: Record<string, AlertLevel> = { R0: 0, R2: 2, R5: 5, R10: 10, R25: 25, R50: 50, R100: 100 };

/**
 * Alertas por caudal alto del Hydroviewer del INAMHI (GEOGLOWS). Cada punto es
 * un tramo de río con su nivel por día (`wd01`…`wd14`: R0 = normal, R2 = supera
 * el caudal de 2 años, … R100). Se leen de las teselas vectoriales que usa el
 * propio Hydroviewer.
 */
@Injectable()
export class HydroviewerAlertsSource extends RiverAlertSource {
  private readonly logger = new Logger(HydroviewerAlertsSource.name);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async getLatestAlerts(): Promise<RiverAlertsSnapshot> {
    // El pronóstico del día se publica durante la mañana: si aún no está, se usa el anterior.
    for (let back = 0; back <= MAX_DAYS_BACK; back++) {
      const date = toEcuadorDate(new Date(Date.now() - back * DAY_MS));
      const snapshot = await this.fetchSnapshot(date);
      if (snapshot) return snapshot;
    }
    throw new UpstreamError(SERVICE, `no hay pronósticos publicados en los últimos ${MAX_DAYS_BACK + 1} días`);
  }

  private async fetchSnapshot(date: string): Promise<RiverAlertsSnapshot | null> {
    const byRiver = new Map<number, RiverAlert>();
    let dayCount = 0;

    for (const { z, x, y } of tilesCovering(ECUADOR_BBOX, ALERTS_ZOOM)) {
      const url = `${this.baseUrl()}/${SOURCE_NAME}/${z}/${x}/${y}?datetime=${date}`;
      const buffer = Buffer.from(await (await fetchWithRetry(url, { service: SERVICE, timeoutMs: 30_000 })).arrayBuffer());
      if (buffer.length === 0) continue;

      const layer = new VectorTile(new PbfReader(buffer)).layers[LAYER_NAME];
      for (let index = 0; index < (layer?.length ?? 0); index++) {
        const feature = layer.feature(index).toGeoJSON(x, y, z);
        const props = feature.properties ?? {};
        const riverId = Number(props.comid);
        if (!Number.isInteger(riverId) || feature.geometry.type !== 'Point') continue;

        const dailyLevels = Object.keys(props)
          .filter((key) => /^wd\d{2}$/.test(key))
          .sort()
          .map((key) => LEVELS[String(props[key])] ?? 0);
        dayCount = Math.max(dayCount, dailyLevels.length);

        const [longitude, latitude] = feature.geometry.coordinates;
        byRiver.set(riverId, {
          riverId,
          latitude,
          longitude,
          streamOrder: Number.isFinite(Number(props.order)) ? Number(props.order) : null,
          province: toTitleCase(props.province) || null,
          canton: toTitleCase(props.canton) || null,
          river: props.river && props.river !== '-' ? String(props.river) : null,
          dailyLevels,
          maxLevel: Math.max(0, ...dailyLevels) as AlertLevel,
        });
      }
    }

    if (byRiver.size === 0) return null;

    const start = Date.parse(`${date}T00:00:00Z`);
    const alerts = [...byRiver.values()].filter((river) => river.maxLevel > 0);
    this.logger.log(`Pronóstico del ${date}: ${byRiver.size} tramos, ${alerts.length} con alerta`);

    return {
      source: 'INAMHI · GEOGLOWS',
      forecastDate: date,
      days: Array.from({ length: dayCount }, (_, day) => new Date(start + day * DAY_MS).toISOString().slice(0, 10)),
      totalReaches: byRiver.size,
      alerts,
    };
  }

  private baseUrl(): string {
    return this.config.get('HYDROVIEWER_TILES_URL').replace(/\/+$/, '');
  }
}
