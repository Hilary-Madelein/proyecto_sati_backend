import { Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service.js';
import { EventsService } from '../events/events.service.js';
import { SyncRunEntity, type SyncTrigger } from './entities/sync-run.entity.js';
import { SourceLock } from './source-lock.js';
import { SyncRunStore } from './sync-run-store.js';
import {
  HazardEventSource,
  type HazardEventSourceAdapter,
  type HazardEventSourceDescriptor,
  type SyncWindow,
} from './hazard-event-source.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class IngestionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IngestionService.name);
  private readonly sources = new Map<string, HazardEventSourceAdapter>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scheduler: SchedulerRegistry,
    private readonly events: EventsService,
    private readonly runs: SyncRunStore,
    private readonly lock: SourceLock,
    private readonly config: AppConfigService,
  ) {}

  /** Descubre las fuentes marcadas con @HazardEventSource() y programa cada una. */
  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders({ metadataKey: HazardEventSource.KEY })) {
      const adapter = wrapper.instance as HazardEventSourceAdapter | undefined;
      if (!adapter) continue;

      const { key, name, enabled, intervalMinutes } = adapter.descriptor;
      if (this.sources.has(key)) throw new Error(`Hay dos fuentes de eventos con la clave "${key}"`);
      this.sources.set(key, adapter);

      if (!enabled) {
        this.logger.warn(`Fuente "${name}" deshabilitada por configuración`);
        continue;
      }

      const interval = setInterval(() => this.runSafely(key, 'schedule'), intervalMinutes * 60_000);
      this.scheduler.addInterval(`ingestion:${key}`, interval);
      this.logger.log(`Fuente "${name}" programada cada ${intervalMinutes} min`);

      if (this.config.get('INGESTION_RUN_ON_STARTUP')) this.runSafely(key, 'startup');
    }

    if (this.sources.size === 0) this.logger.warn('No hay fuentes de eventos registradas');
  }

  /** Fuentes registradas con su última sincronización. */
  async listSources(): Promise<Array<HazardEventSourceDescriptor & { lastRun: SyncRunEntity | null }>> {
    return Promise.all(
      [...this.sources.values()].map(async ({ descriptor }) => ({
        ...descriptor,
        lastRun: await this.runs.findLatest(descriptor.key),
      })),
    );
  }

  listRuns(source: string | undefined, limit: number): Promise<SyncRunEntity[]> {
    return this.runs.list(source, limit);
  }

  /** Lanza una sincronización sin esperar a que termine (para el endpoint manual). */
  trigger(key: string): void {
    this.getSource(key);
    this.runSafely(key, 'manual');
  }

  /**
   * Sincroniza una fuente con un bloqueo por fuente, así una ejecución manual y
   * una programada (o dos instancias del backend) nunca la consultan a la vez.
   * Devuelve null si ya estaba en curso.
   */
  async run(key: string, trigger: SyncTrigger): Promise<SyncRunEntity | null> {
    const adapter = this.getSource(key);
    const result = await this.lock.runExclusive(`ingestion:${key}`, () => this.execute(adapter, trigger));
    if (result === null) this.logger.debug(`"${adapter.descriptor.name}" ya se está sincronizando; se omite`);
    return result;
  }

  private runSafely(key: string, trigger: SyncTrigger): void {
    this.run(key, trigger).catch((error: unknown) =>
      this.logger.error(`No se pudo sincronizar "${key}": ${(error as Error).message}`, (error as Error).stack),
    );
  }

  private async execute(adapter: HazardEventSourceAdapter, trigger: SyncTrigger): Promise<SyncRunEntity> {
    const { key, name } = adapter.descriptor;
    const window = await this.nextWindow(adapter.descriptor);
    const run = await this.runs.save(
      Object.assign(new SyncRunEntity(), {
        source: key,
        status: 'running',
        trigger,
        windowFrom: window.from,
        windowTo: window.to,
        startedAt: new Date(),
        finishedAt: null,
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        error: null,
      }),
    );

    try {
      const items = await adapter.fetchEvents(window);
      const result = await this.events.upsertMany(key, items);
      Object.assign(run, { status: 'success', fetched: items.length, ...result });
      this.logger.log(
        `"${name}": ${items.length} recibidos · ${result.created} nuevos · ${result.updated} actualizados · ${result.unchanged} sin cambios`,
      );
    } catch (error) {
      Object.assign(run, { status: 'failed', error: (error as Error).message });
      this.logger.error(`"${name}" falló: ${(error as Error).message}`);
    }

    run.finishedAt = new Date();
    return this.runs.save(run);
  }

  /** Desde el final de la última sincronización exitosa (con solape) o, la primera vez, `backfillDays` atrás. */
  private async nextWindow(descriptor: HazardEventSourceDescriptor): Promise<SyncWindow> {
    const to = new Date();
    const lastSuccess = await this.runs.findLatestSuccess(descriptor.key);
    const from = lastSuccess
      ? new Date(lastSuccess.windowTo.getTime() - descriptor.overlapHours * HOUR_MS)
      : new Date(to.getTime() - descriptor.backfillDays * DAY_MS);
    return { from, to };
  }

  private getSource(key: string): HazardEventSourceAdapter {
    const adapter = this.sources.get(key);
    if (!adapter) throw new NotFoundException(`No existe la fuente "${key}"`);
    return adapter;
  }
}
