import type { CantonForecast } from './flash-flood-cantons.js';
import { zoneOfCanton } from './planning-zones.js';

export interface ScopeCanton {
  code: string;
  name: string;
  province: string;
}

/**
 * Qué alertas eligió recibir cada persona: las zonas de planificación,
 * provincias y cantones marcados, o todo el país si no marcó ninguno. Queda
 * guardado hasta que lo cambie.
 */
export interface ChatScope {
  /** Números de zona de planificación (1 a 9). */
  zones: number[];
  /** Nombres oficiales de provincia. */
  provinces: string[];
  cantons: ScopeCanton[];
}

/** Todo el país. Lo elegido siempre se reemplaza por arreglos nuevos: este nunca se modifica. */
export const NATIONAL: ChatScope = { zones: [], provinces: [], cantons: [] };

const choices = (chat: ChatScope) => chat.zones.length + chat.provinces.length + chat.cantons.length;

export const isNational = (chat: ChatScope) => choices(chat) === 0;

export function inScope(chat: ChatScope, canton: Pick<CantonForecast, 'code' | 'province'>): boolean {
  if (isNational(chat)) return true;
  if (chat.provinces.includes(canton.province) || chat.cantons.some(({ code }) => code === canton.code)) return true;
  const zone = zoneOfCanton(canton.code);
  return zone !== null && chat.zones.includes(zone);
}

export function filterToScope<T extends Pick<CantonForecast, 'code' | 'province'>>(chat: ChatScope, cantons: readonly T[]): T[] {
  return cantons.filter((canton) => inScope(chat, canton));
}

/** El único lugar elegido; null si es todo el país o si son varios. */
export function singlePlace(chat: ChatScope): string | null {
  if (choices(chat) !== 1) return null;
  if (chat.zones.length === 1) return `la Zona ${chat.zones[0]}`;
  return chat.provinces[0] ?? chat.cantons[0].name;
}

/** Texto de lo elegido, para confirmarlo a la persona. */
export function scopeLabel(chat: ChatScope): string {
  if (isNational(chat)) return 'todo el país';
  return [
    ...[...chat.zones].sort((a, b) => a - b).map((zone) => `Zona ${zone}`),
    ...chat.provinces,
    ...chat.cantons.map(({ name, province }) => `${name} (cantón de ${province})`),
  ].join(', ');
}
