import { Injectable } from '@nestjs/common';
import { loadParishes, type ParishPoint } from '../canton-analysis/parishes.js';

export interface CatalogCanton {
  code: string;
  name: string;
}

export interface CatalogProvince {
  name: string;
  cantons: CatalogCanton[];
}

const byName = (a: string, b: string) => a.localeCompare(b, 'es');

/** Parroquias, provincias y cantones del archivo fijo: se leen una vez. */
@Injectable()
export class CantonCatalog {
  private loading: Promise<ParishPoint[]> | null = null;

  parishes(): Promise<ParishPoint[]> {
    return (this.loading ??= loadParishes());
  }

  /** Provincias y sus cantones en orden alfabético. El orden es fijo: los botones usan la posición de cada provincia. */
  async provinces(): Promise<CatalogProvince[]> {
    const provinces = new Map<string, Map<string, string>>();
    for (const { province, cantonCode, canton } of await this.parishes()) {
      if (!provinces.has(province)) provinces.set(province, new Map());
      provinces.get(province)!.set(cantonCode, canton);
    }
    return [...provinces.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([name, cantons]) => ({
        name,
        cantons: [...cantons.entries()].map(([code, canton]) => ({ code, name: canton })).sort((a, b) => byName(a.name, b.name)),
      }));
  }
}
