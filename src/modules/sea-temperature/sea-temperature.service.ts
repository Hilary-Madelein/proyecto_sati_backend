import { BadGatewayException, Injectable } from '@nestjs/common';
import { TtlCache } from '../../common/cache/ttl-cache.js';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { createColorRamp, type ColorStop } from '../../common/raster/color-ramp.js';
import { isInsideRings } from '../../common/geo/polygon.js';
import { SEA_REGION_LAND_RINGS } from '../../common/geo/sea-region-land.js';
import { fillGaps, valueAt, type RasterGrid } from '../../common/raster/raster-grid.js';
import { renderGridPng } from '../../common/raster/render-png.js';
import { SeaTemperatureSource } from './sea-temperature-source.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** El dato llega con ~1 día de retraso: si el último es más viejo que esto, se avisa. */
const STALE_AFTER_MS = 4 * DAY_MS;
/** El dato cambia una vez al día. */
const CACHE_MS = 3 * HOUR_MS;
/** La imagen se recorta a la costa real (la grilla de 0,25° la dibuja en escalones). */
const RENDER_OPTIONS = { scale: 12, smooth: true, exclude: SEA_REGION_LAND_RINGS } as const;
/**
 * Celdas que se extienden hacia la costa: la grilla marca como tierra toda celda
 * que la toca, y sin esto quedaría una franja vacía entre el color y la orilla.
 */
const COAST_FILL_PASSES = 2;

/** Región Niño 1+2 (frente a Ecuador y Perú), [oeste, sur, este, norte]: la que se vigila para El Niño costero. */
export const NINO_12_BBOX = [-90, -10, -80, 0] as const;

/**
 * Anomalía en °C: azul = más frío de lo normal, blanco = normal, rojo = más
 * cálido. Debajo de la primera parada no se pinta.
 */
export const ANOMALY_STOPS: readonly ColorStop[] = [
  { value: -4, color: '#2166ac', opacity: 1 },
  { value: -2, color: '#67a9cf', opacity: 1 },
  { value: -0.5, color: '#d1e5f0', opacity: 1 },
  { value: 0, color: '#f7f7f7', opacity: 1 },
  { value: 0.5, color: '#fddbc7', opacity: 1 },
  { value: 1.5, color: '#f4a582', opacity: 1 },
  { value: 3, color: '#d6604d', opacity: 1 },
  { value: 5, color: '#b2182b', opacity: 1 },
  { value: 7, color: '#67001f', opacity: 1 },
];

export interface SeaTemperatureAnomaly {
  /** Día del dato (ISO 8601). */
  time: string;
  isStale: boolean;
  attribution: string;
  /** [[sur, oeste], [norte, este]] para superponer la imagen en el mapa. */
  bounds: [[number, number], [number, number]];
  /** Anomalía media de la región Niño 1+2 (°C); null si no hay datos en ella. */
  nino12Anomaly: number | null;
  /** Anomalía menor y mayor del recuadro (°C). */
  minAnomaly: number;
  maxAnomaly: number;
  /** Paleta de la imagen, para la leyenda. */
  legend: { unit: string; entries: { value: number; color: string }[] };
  /** Ruta (relativa a la API) de la imagen PNG. */
  imagePath: string;
}

/** Temperatura y anomalía del mar en un punto; null en tierra o fuera del recuadro. */
export interface SeaTemperaturePoint {
  time: string;
  /** Temperatura superficial (°C). */
  sst: number | null;
  /** Anomalía (°C). */
  anomaly: number | null;
}

interface Rendered {
  meta: SeaTemperatureAnomaly;
  png: Buffer;
  sst: RasterGrid;
  anomaly: RasterGrid;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Promedio de las celdas con dato cuyo centro cae dentro del recuadro [oeste, sur, este, norte]; null si no hay ninguna. */
export function meanInBox(grid: RasterGrid, box: readonly [number, number, number, number]): number | null {
  const [west, south, east, north] = grid.bbox;
  const [boxWest, boxSouth, boxEast, boxNorth] = box;
  let total = 0;
  let count = 0;
  for (let row = 0; row < grid.height; row++) {
    const lat = north - ((row + 0.5) / grid.height) * (north - south);
    if (lat < boxSouth || lat > boxNorth) continue;
    for (let col = 0; col < grid.width; col++) {
      const lng = west + ((col + 0.5) / grid.width) * (east - west);
      const value = grid.values[row * grid.width + col];
      if (lng < boxWest || lng > boxEast || !Number.isFinite(value) || value === grid.noData) continue;
      total += value;
      count++;
    }
  }
  return count === 0 ? null : total / count;
}

/**
 * Anomalía de la temperatura del mar frente a Ecuador (indicador de El Niño):
 * la imagen pinta la diferencia con lo normal, y el valor de un punto da también
 * la temperatura. Se cachea unas horas: la fuente publica un dato por día.
 */
@Injectable()
export class SeaTemperatureService {
  private readonly cache = new TtlCache<Rendered>(CACHE_MS, 1);

  constructor(private readonly source: SeaTemperatureSource) {}

  async current(): Promise<SeaTemperatureAnomaly> {
    return (await this.render()).meta;
  }

  async image(): Promise<Buffer> {
    return (await this.render()).png;
  }

  async valueAt(lat: number, lng: number): Promise<SeaTemperaturePoint> {
    const { meta, sst, anomaly } = await this.render();
    // Igual que la imagen: en tierra no hay dato; en el mar junto a la costa, el valor extendido.
    if (isInsideRings(SEA_REGION_LAND_RINGS, lng, lat)) return { time: meta.time, sst: null, anomaly: null };
    const [temperature, difference] = [valueAt(sst, lat, lng), valueAt(anomaly, lat, lng)];
    return {
      time: meta.time,
      sst: temperature === null ? null : round1(temperature),
      anomaly: difference === null ? null : round1(difference),
    };
  }

  private async render(): Promise<Rendered> {
    try {
      return await this.cache.get('latest', async () => {
        const field = await this.source.getLatest();
        const [west, south, east, north] = field.anomaly.bbox;
        const finite = Array.from(field.anomaly.values).filter(Number.isFinite);
        const nino = meanInBox(field.anomaly, NINO_12_BBOX);
        const anomaly = fillGaps(field.anomaly, COAST_FILL_PASSES);
        return {
          sst: fillGaps(field.sst, COAST_FILL_PASSES),
          anomaly,
          png: renderGridPng(anomaly, createColorRamp([...ANOMALY_STOPS]), RENDER_OPTIONS),
          meta: {
            time: field.time,
            isStale: Date.parse(field.time) < Date.now() - STALE_AFTER_MS,
            attribution: this.source.attribution,
            bounds: [
              [south, west],
              [north, east],
            ],
            nino12Anomaly: nino === null ? null : round1(nino),
            minAnomaly: round1(finite.length ? finite.reduce((a, b) => Math.min(a, b)) : 0),
            maxAnomaly: round1(finite.length ? finite.reduce((a, b) => Math.max(a, b)) : 0),
            legend: { unit: '°C', entries: ANOMALY_STOPS.map(({ value, color }) => ({ value, color })) },
            imagePath: `/sea-temperature/image?time=${encodeURIComponent(field.time)}`,
          },
        };
      });
    } catch (error) {
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }
}
