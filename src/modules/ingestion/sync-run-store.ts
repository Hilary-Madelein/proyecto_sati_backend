import type { SyncRunEntity } from './entities/sync-run.entity.js';

/** Contrato de almacenamiento de la bitácora de sincronizaciones (ver `src/storage/`). */
export abstract class SyncRunStore {
  /** Inserta o actualiza una ejecución. Las nuevas quedan con su `id` asignado. */
  abstract save(run: SyncRunEntity): Promise<SyncRunEntity>;
  /** Última ejecución de una fuente (por fecha de inicio). */
  abstract findLatest(source: string): Promise<SyncRunEntity | null>;
  /** Última ejecución exitosa de una fuente (por fin de su ventana). */
  abstract findLatestSuccess(source: string): Promise<SyncRunEntity | null>;
  /** Ejecuciones más recientes, de una fuente o de todas. */
  abstract list(source: string | undefined, limit: number): Promise<SyncRunEntity[]>;
}
