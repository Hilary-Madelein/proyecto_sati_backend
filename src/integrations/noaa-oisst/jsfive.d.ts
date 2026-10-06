/** Tipos mínimos de jsfive (lector de HDF5 / NetCDF-4 en JavaScript), solo lo que se usa aquí. */
declare module 'jsfive' {
  export class Dataset {
    readonly shape: number[];
    readonly dtype: string;
    readonly attrs: Record<string, unknown>;
    readonly value: ArrayLike<number>;
  }

  export class File {
    constructor(buffer: ArrayBuffer, filename?: string);
    readonly keys: string[];
    get(path: string): Dataset;
  }
}
