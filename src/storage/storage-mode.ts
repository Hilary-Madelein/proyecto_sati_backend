export type StorageMode = 'memory' | 'postgres';

/** Token de inyección con el modo de almacenamiento activo. */
export const STORAGE_MODE = Symbol('STORAGE_MODE');
