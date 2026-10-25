import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { FloodHubSource, type FloodHubGauge, type FloodHubSeverity } from './flood-hub-source.js';

/** Google actualiza el estado unas veces al día: se vuelve a consultar cada 30 minutos. */
const REFRESH_MS = 30 * 60 * 1000;

/** Severidades que cuentan como aviso (por encima de lo normal o peor). */
const FLAGGED: ReadonlySet<FloodHubSeverity> = new Set(['above_normal', 'severe', 'extreme']);

export interface FloodHubSnapshot {
  fetchedAt: string;
  /** Emisión más reciente entre todos los puntos (ISO 8601). */
  issuedAt: string | null;
  attribution: string;
  /** True si la fuente falló y se entrega la última descarga buena. */
  isStale: boolean;
  /** Puntos con aviso (por encima de lo normal, severo o extremo). */
  flaggedCount: number;
  /** Primero los de mayor severidad. */
  gauges: FloodHubGauge[];
}

const SEVERITY_RANK: Record<FloodHubSeverity, number> = {
  extreme: 4,
  severe: 3,
  above_normal: 2,
  no_flooding: 1,
  unknown: 0,
};

/** Pronóstico de inundaciones de Google Flood Hub en los puntos del Ecuador. */
@Injectable()
export class FloodHubService {
  private readonly logger = new Logger(FloodHubService.name);
  private latest: FloodHubSnapshot | null = null;
  private loading: Promise<FloodHubSnapshot> | null = null;

  constructor(private readonly source: FloodHubSource) {}

  async snapshot(): Promise<FloodHubSnapshot> {
    if (this.latest && Date.now() - Date.parse(this.latest.fetchedAt) < REFRESH_MS) return this.latest;
    try {
      this.loading ??= this.load().finally(() => (this.loading = null));
      return (this.latest = await this.loading);
    } catch (error) {
      if (this.latest) {
        this.logger.warn(`Flood Hub: se entrega la descarga anterior (${(error as Error).message})`);
        return { ...this.latest, isStale: true };
      }
      if (error instanceof UpstreamError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  private async load(): Promise<FloodHubSnapshot> {
    const gauges = (await this.source.getGauges()).sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    );
    const issued = gauges.map((gauge) => gauge.issuedAt).filter((time) => time !== null).sort();
    return {
      fetchedAt: new Date().toISOString(),
      issuedAt: issued.at(-1) ?? null,
      attribution: this.source.attribution,
      isStale: false,
      flaggedCount: gauges.filter((gauge) => FLAGGED.has(gauge.severity)).length,
      gauges,
    };
  }
}
