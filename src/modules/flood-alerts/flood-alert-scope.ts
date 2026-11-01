import type { CantonForecast } from './flash-flood-cantons.js';

export interface ScopeCanton {
  code: string;
  name: string;
  province: string;
}

/**
 * Qué alertas eligió recibir cada persona: las provincias y cantones marcados, o
 * todo el país si no marcó ninguno. Queda guardado hasta que lo cambie.
 */
export interface ChatScope {
  /** Nombres oficiales de provincia. */
  provinces: string[];
  cantons: ScopeCanton[];
}

/** Todo el país. Lo elegido siempre se reemplaza por arreglos nuevos: este nunca se modifica. */
export const NATIONAL: ChatScope = { provinces: [], cantons: [] };

export const isNational = (chat: ChatScope) => chat.provinces.length === 0 && chat.cantons.length === 0;

export function inScope(chat: ChatScope, canton: Pick<CantonForecast, 'code' | 'province'>): boolean {
  return isNational(chat) || chat.provinces.includes(canton.province) || chat.cantons.some(({ code }) => code === canton.code);
}

export function filterToScope<T extends Pick<CantonForecast, 'code' | 'province'>>(chat: ChatScope, cantons: readonly T[]): T[] {
  return cantons.filter((canton) => inScope(chat, canton));
}

/** El único lugar elegido; null si es todo el país o si son varios. */
export function singlePlace(chat: ChatScope): string | null {
  if (chat.provinces.length + chat.cantons.length !== 1) return null;
  return chat.provinces[0] ?? chat.cantons[0].name;
}

/** Texto de lo elegido, para confirmarlo a la persona. */
export function scopeLabel(chat: ChatScope): string {
  if (isNational(chat)) return 'todo el país';
  return [...chat.provinces, ...chat.cantons.map(({ name, province }) => `${name} (cantón de ${province})`)].join(', ');
}
