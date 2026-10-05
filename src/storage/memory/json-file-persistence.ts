import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';

/** Espera antes de escribir: agrupa muchos cambios seguidos en una sola escritura. */
const SAVE_DELAY_MS = 1_000;

/**
 * Guarda en archivos JSON lo que el almacenamiento en memoria tiene, para que
 * un reinicio (p. ej. `nest start --watch` al guardar un archivo) no lo pierda.
 * Solo se usa con STORAGE=memory; con MEMORY_PERSIST_DIR vacío no guarda nada.
 */
@Injectable()
export class JsonFilePersistence implements OnModuleDestroy {
  private readonly logger = new Logger(JsonFilePersistence.name);
  private readonly dir: string | null;
  private readonly pending = new Map<string, () => unknown>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(config: AppConfigService) {
    this.dir = config.get('MEMORY_PERSIST_DIR') || null;
  }

  /** Datos guardados con ese nombre, o null si no hay (o si el archivo está dañado). */
  load<T>(name: string): T | null {
    if (!this.dir) return null;
    try {
      return JSON.parse(readFileSync(this.path(name), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /** Programa guardar `snapshot()`; los pedidos seguidos se agrupan en una escritura. */
  save(name: string, snapshot: () => unknown): void {
    if (!this.dir) return;
    this.pending.set(name, snapshot);
    clearTimeout(this.timers.get(name));
    this.timers.set(
      name,
      setTimeout(() => this.flush(name), SAVE_DELAY_MS),
    );
  }

  /** Al apagarse, escribe lo pendiente para no perder el último segundo. */
  onModuleDestroy(): void {
    for (const name of this.pending.keys()) this.flush(name);
  }

  private flush(name: string): void {
    const snapshot = this.pending.get(name);
    if (!snapshot || !this.dir) return;
    this.pending.delete(name);
    clearTimeout(this.timers.get(name));
    try {
      mkdirSync(this.dir, { recursive: true });
      // Escritura atómica: primero a un temporal y luego se renombra.
      const temporary = `${this.path(name)}.tmp`;
      writeFileSync(temporary, JSON.stringify(snapshot()));
      renameSync(temporary, this.path(name));
    } catch (error) {
      this.logger.warn(`No se pudo guardar "${name}": ${(error as Error).message}`);
    }
  }

  private path(name: string): string {
    return join(this.dir!, `${name}.json`);
  }
}
