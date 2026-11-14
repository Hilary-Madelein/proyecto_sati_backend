import { escapeHtml } from '../../common/text/escape-html.js';
import type { TelegramMessage } from '../../integrations/telegram/telegram.client.js';
import { REFERENCE_EVENTS } from './galapagos-rain.js';
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

/** La alarma de lluvia de una estación de Galápagos, como mensaje de Telegram (HTML). */
export function galapagosAlertMessage(station: GalapagosStationRain): TelegramMessage {
  const extreme = station.level === 'extreme';
  const [upper, lower] = REFERENCE_EVENTS;
  const lines = [
    `${extreme ? '🚨' : '⚠️'} <b>SATI · ${extreme ? 'Alarma extrema' : 'Alarma'} de lluvia en Galápagos</b>`,
    `📍 ${escapeHtml(station.island)} · estación ${escapeHtml(station.code)} (${escapeHtml(station.place)})`,
    ...(station.lastTime ? [`🕒 Medido hasta: ${escapeHtml(timeFormat.format(new Date(station.lastTime)))} (hora de Galápagos)`] : []),
    '',
    `🌧️ <b>${mm(station.mm24h)} en las últimas 24 horas</b> (umbral de alarma: ${station.alarmThresholdMm} mm).`,
    `En la última hora, ${mm(station.mm1h)}; en 3 horas, ${mm(station.mm3h)}; en 6 horas, ${mm(station.mm6h)}.`,
    ...(station.priorMm !== null && station.priorMm >= 1
      ? [`Lluvia previa: ${mm(station.priorMm)} en los tres días anteriores${station.loaded ? ' (suelo cargado: el umbral baja a la mitad)' : ''}.`]
      : []),
    ...(station.reason ? ['', `<b>Por qué salta:</b> ${escapeHtml(station.reason)}.`] : []),
    '',
    '<b>Para comparar, en estas mismas estaciones:</b>',
    `• ${escapeHtml(upper.island)}, ${escapeHtml(upper.date)}: ${mm(upper.totalMm)} en 24 horas y ${mm(upper.max3hMm)} en 3 horas; ${escapeHtml(upper.outcome)}.`,
    `• ${escapeHtml(lower.island)}, ${escapeHtml(lower.date)}: ${mm(lower.totalMm)} en 24 horas y ${mm(lower.max3hMm)} en 3 horas; ${escapeHtml(lower.outcome)}.`,
    '',
    '<i>Lluvia medida por el INAMHI en la costa; en la parte alta puede estar lloviendo más. Sigue los avisos de la SNGR, del COE y del INAMHI.</i>',
  ];
  return { text: lines.join('\n'), silent: false };
}
