import { escapeHtml } from '../../common/text/escape-html.js';
import type { TelegramMessage } from '../../integrations/telegram/telegram.client.js';
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

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const HEADINGS = {
  alarm: { icon: '⚠️', title: 'Alarma de lluvia en Galápagos' },
  extreme: { icon: '🚨', title: 'Alarma extrema de lluvia en Galápagos' },
} as const;

/** El aviso de lluvia de una estación de Galápagos, como mensaje de Telegram (HTML): lo justo para decidir. */
export function galapagosAlertMessage(station: GalapagosStationRain): TelegramMessage {
  const { icon, title } = HEADINGS[station.level === 'extreme' ? 'extreme' : 'alarm'];
  const sinceYesterday = station.twoDays.at(-1)?.accumulatedMm ?? station.mm24h;
  const upper = station.limits.find(({ key }) => key === 'upper');
  const lower = station.limits.find(({ key }) => key === 'lower');
  const lines = [
    `${icon} <b>SATI · ${title}</b>`,
    `📍 ${escapeHtml(station.island)} · estación ${escapeHtml(station.code)} (${escapeHtml(station.place)})`,
    ...(station.lastTime ? [`🕒 Hasta: ${escapeHtml(timeFormat.format(new Date(station.lastTime)))} (hora de Galápagos)`] : []),
    '',
    ...(station.reason ? [`🌧️ <b>${escapeHtml(station.reason.charAt(0).toUpperCase() + station.reason.slice(1))}.</b>`] : []),
    `Última hora: ${mm(station.mm1h)} · 5 horas: ${mm(station.mm5h)} · desde ayer: ${mm(sinceYesterday)}`,
    ...(upper && lower ? [`En dos días, sus referencias: ${mm(lower.totalMm)} (${lowerFirst(lower.label)}) y ${mm(upper.totalMm)} (${lowerFirst(upper.label)}).`] : []),
  ];
  return { text: lines.join('\n'), silent: false };
}
