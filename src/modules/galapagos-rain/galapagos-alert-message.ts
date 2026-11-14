import { escapeHtml } from '../../common/text/escape-html.js';
import type { TelegramMessage } from '../../integrations/telegram/telegram.client.js';
import { TWO_DAY_LIMITS, accumulate } from './galapagos-rain.js';
import type { GalapagosStationRain } from './galapagos-rain.service.js';

const mm = (value: number) => `${value.toLocaleString('es-EC', { maximumFractionDigits: 1 })} mm`;

const timeFormat = new Intl.DateTimeFormat('es-EC', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Pacific/Galapagos',
});

const HEADINGS = {
  alarm: { icon: '⚠️', title: 'Alarma de lluvia en Galápagos' },
  extreme: { icon: '🚨', title: 'Alarma extrema de lluvia en Galápagos' },
} as const;

const [UPPER_MM, LOWER_MM] = TWO_DAY_LIMITS.map(({ hourlyMm }) => accumulate(hourlyMm).at(-1) ?? 0);

/** El aviso de lluvia de una estación de Galápagos, como mensaje de Telegram (HTML): lo justo para decidir. */
export function galapagosAlertMessage(station: GalapagosStationRain): TelegramMessage {
  const { icon, title } = HEADINGS[station.level === 'extreme' ? 'extreme' : 'alarm'];
  const sinceYesterday = station.twoDays.at(-1)?.accumulatedMm ?? station.mm24h;
  const lines = [
    `${icon} <b>SATI · ${title}</b>`,
    `📍 ${escapeHtml(station.island)} · estación ${escapeHtml(station.code)} (${escapeHtml(station.place)})`,
    ...(station.lastTime ? [`🕒 Hasta: ${escapeHtml(timeFormat.format(new Date(station.lastTime)))} (hora de Galápagos)`] : []),
    '',
    ...(station.reason ? [`🌧️ <b>${escapeHtml(station.reason.charAt(0).toUpperCase() + station.reason.slice(1))}.</b>`] : []),
    `Última hora: ${mm(station.mm1h)} · 5 horas: ${mm(station.mm5h)} · desde ayer: ${mm(sinceYesterday)}`,
    `Referencias de Santa Cruz en dos días: ${mm(LOWER_MM)} (límite inferior) y ${mm(UPPER_MM)} (desborde del 30-31 de octubre).`,
  ];
  return { text: lines.join('\n'), silent: false };
}
