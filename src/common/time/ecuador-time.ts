/**
 * Ecuador continental usa UTC-5 todo el año (sin horario de verano). Las
 * fuentes nacionales entregan fechas y horas locales sin zona horaria.
 */
export const ECUADOR_UTC_OFFSET = '-05:00';
const ECUADOR_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha local de Ecuador en formato AAAA-MM-DD. */
export function toEcuadorDate(date: Date): string {
  return new Date(date.getTime() + ECUADOR_OFFSET_MS).toISOString().slice(0, 10);
}

/** Normaliza horas como "9:40" o "09:40:00" a "09:40". Devuelve "00:00" si no se entiende. */
export function normalizeTime(value: unknown): string {
  const match = /^(\d{1,2}):(\d{1,2})/.exec(String(value ?? '').trim());
  if (!match) return '00:00';
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  if (hours > 23 || minutes > 59) return '00:00';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Combina fecha (AAAA-MM-DD) y hora locales de Ecuador en un instante UTC. */
export function parseEcuadorDateTime(date: string, time: unknown): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T${normalizeTime(time)}:00${ECUADOR_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface DateRange {
  /** AAAA-MM-DD, inclusive. */
  from: string;
  /** AAAA-MM-DD, inclusive. */
  to: string;
}

/**
 * Parte el intervalo [from, to] en rangos de fechas de Ecuador de como máximo
 * `maxDays` días (inclusive en ambos extremos), sin solaparse.
 */
export function splitIntoDateRanges(from: Date, to: Date, maxDays: number): DateRange[] {
  if (maxDays < 1) throw new Error('maxDays debe ser al menos 1');
  const ranges: DateRange[] = [];
  const end = Date.parse(toEcuadorDate(to));
  let cursor = Date.parse(toEcuadorDate(from));

  while (cursor <= end) {
    const rangeEnd = Math.min(cursor + (maxDays - 1) * DAY_MS, end);
    ranges.push({
      from: new Date(cursor).toISOString().slice(0, 10),
      to: new Date(rangeEnd).toISOString().slice(0, 10),
    });
    cursor = rangeEnd + DAY_MS;
  }
  return ranges;
}
