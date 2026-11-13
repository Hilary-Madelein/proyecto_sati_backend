import { escapeHtml } from '../../common/text/escape-html.js';
import type { TelegramButton } from '../../integrations/telegram/telegram.client.js';
import { NATIONAL_SCOPE, provinceScope, sameProvince, type SituationScope } from '../situation-analysis/situation-facts.js';
import type { SituationAnalysis } from '../situation-analysis/situation-analysis.service.js';
import { isNational, scopeLabel, type ChatScope } from './flood-alert-scope.js';
import { zoneOfCanton } from './planning-zones.js';

/** Botón que acompaña a cada alerta: pide el análisis de la situación de lo que eligió la persona. */
export const ANALYZE = 'an';
export const ANALYZE_BUTTON: TelegramButton = { label: '🧠 Analizar la situación actual', data: ANALYZE };

export const ANALYZING = '⏳ Analizando la situación actual… tarda unos segundos.';
export const ANALYSIS_FAILED = 'No se pudo preparar el análisis en este momento. Intenta de nuevo en unos minutos.';

/** Lo que eligió el chat, como ámbito del análisis. Una sola provincia comparte el análisis con el visor. */
export function chatSituationScope(chat: ChatScope): SituationScope {
  if (isNational(chat)) return NATIONAL_SCOPE;
  if (chat.provinces.length === 1 && chat.zones.length === 0 && chat.cantons.length === 0) return provinceScope(chat.provinces[0]);
  const zones = [...chat.zones].sort((a, b) => a - b);
  const provinces = [...chat.provinces].sort();
  const cantons = chat.cantons.map(({ code }) => code).sort();
  return {
    key: `tg:${zones.join(',')}|${provinces.join(',')}|${cantons.join(',')}`,
    label: scopeLabel(chat),
    severalProvinces: zones.length > 0 || provinces.length > 0 || new Set(chat.cantons.map(({ province }) => province)).size > 1,
    includes: ({ cantonCode, province }) => {
      if (provinces.some((name) => sameProvince(name, province)) || cantons.includes(cantonCode)) return true;
      const zone = zoneOfCanton(cantonCode);
      return zone !== null && zones.includes(zone);
    },
  };
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** El análisis como mensaje de Telegram (HTML). Cada bloque es HTML completo: un mensaje largo se parte por ahí. */
export function analysisMessage(analysis: SituationAnalysis): string {
  return [
    `🧠 <b>SATI · Análisis de la situación</b>\n📍 ${escapeHtml(cap(analysis.place))}\n🕒 Datos de: ${escapeHtml(analysis.dataTime)}`,
    `<b>${escapeHtml(analysis.headline)}</b>`,
    `<b>Pronóstico y posibles afectaciones:</b> ${escapeHtml(analysis.situation)}`,
    `<b>Plan de contingencia:</b> ${escapeHtml(analysis.plan)}`,
    ...(analysis.reference ? [`<b>Referencia, episodios anteriores de El Niño:</b> ${escapeHtml(analysis.reference)}`] : []),
    ...(analysis.missing.length > 0 ? [`<i>Sin datos ahora de: ${escapeHtml(analysis.missing.join(', '))}.</i>`] : []),
    `<i>Fuentes: ${escapeHtml(analysis.sources)}. ${escapeHtml(analysis.note)}</i>`,
  ].join('\n\n');
}
