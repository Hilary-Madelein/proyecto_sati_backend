import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { escapeHtml } from '../../common/text/escape-html.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { TelegramClient, TelegramError, type TelegramMessage } from '../../integrations/telegram/telegram.client.js';
import { normalizeText } from '../canton-analysis/preparedness.js';
import type { TelegramChatEntity } from '../flood-alerts/entities/telegram-chat.entity.js';
import { isNational, type ChatScope } from '../flood-alerts/flood-alert-scope.js';
import { TelegramChatStore } from '../flood-alerts/flood-alert-stores.js';
import { zoneOfCanton } from '../flood-alerts/planning-zones.js';
import { NotificationDeliveryEntity } from '../notifications/entities/notification-delivery.entity.js';
import { DeliveryStore } from '../notifications/notification-stores.js';
import { galapagosAlertMessage } from './galapagos-alert-message.js';
import { GALAPAGOS_PROVINCE } from './galapagos-rain.js';
import { SCENARIO_RANK, type GalapagosScenario } from './galapagos-sea.js';
import { GalapagosRainService, type GalapagosStationRain } from './galapagos-rain.service.js';

const CHANNEL = 'telegram';
/** Cada cuánto se mira si llegó un dato nuevo. La decisión se toma una vez por dato (uno por hora). */
const CHECK_MS = 5 * 60 * 1000;
/** La primera revisión espera a que carguen las estaciones. */
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
/** Pausa entre envíos: Telegram admite unos 30 mensajes por segundo. */
const SEND_GAP_MS = 50;
/** Si el último dato de la estación es más viejo que esto, no se avisa con él. */
const MAX_DATA_AGE_MS = 3 * 60 * 60 * 1000;

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Galapagos' });

/** ¿A este chat le toca lo de un cantón de Galápagos? Todo el país, la provincia, su zona o el cantón. */
export function wantsGalapagos(chat: ChatScope, cantonCode: string): boolean {
  if (isNational(chat)) return true;
  if (chat.provinces.some((province) => normalizeText(province) === normalizeText(GALAPAGOS_PROVINCE))) return true;
  if (chat.cantons.some(({ code }) => code === cantonCode)) return true;
  const zone = zoneOfCanton(cantonCode);
  return zone !== null && chat.zones.includes(zone);
}

/**
 * Vigila la lluvia de las dos estaciones de Galápagos, cruzada con el nivel del mar
 * (la matriz de galapagos-sea.ts), y avisa por Telegram cuando una sube a alerta o a
 * emergencia. La precaución (mar alto sin lluvia) no se avisa: pasa con cada pleamar.
 * Decide una vez por hora, cuando llega el dato de la estación, con el mar de ese
 * momento. Mientras siga en la misma casilla no repite; el historial de envíos evita repetir
 * tras un reinicio el mismo día.
 * Nunca lanza errores hacia afuera.
 */
@Injectable()
export class GalapagosAlertsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GalapagosAlertsService.name);
  /** Casilla de la matriz de cada estación en la revisión anterior. */
  private readonly scenarios = new Map<string, GalapagosScenario>();
  /** Hora del último dato de cada estación con que ya se decidió. */
  private readonly decided = new Map<string, string>();
  private firstCheck?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    private readonly rain: GalapagosRainService,
    private readonly telegram: TelegramClient,
    private readonly chats: TelegramChatStore,
    private readonly deliveries: DeliveryStore,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.telegram.enabled) return;
    this.firstCheck = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => void this.check(), CHECK_MS);
  }

  onApplicationShutdown(): void {
    clearTimeout(this.firstCheck);
    clearInterval(this.timer);
  }

  async check(now = new Date()): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const { stations } = await this.rain.snapshot(now);
      for (const station of stations) {
        const fresh = station.lastTime !== null && now.getTime() - Date.parse(station.lastTime) <= MAX_DATA_AGE_MS;
        // Sin dato reciente no se sabe el nivel: se conserva el anterior.
        if (!fresh) continue;
        // Las estaciones publican un dato por hora: se decide una vez por dato, con el mar de ese momento.
        if (this.decided.get(station.code) === station.lastTime) continue;
        this.decided.set(station.code, station.lastTime!);
        const before = this.scenarios.get(station.code) ?? 'normal';
        this.scenarios.set(station.code, station.scenario);
        const rank = SCENARIO_RANK[station.scenario];
        if (rank > SCENARIO_RANK[before] && rank >= SCENARIO_RANK.alert) await this.notify(station, now);
      }
    } catch (error) {
      this.logger.error(`No se pudo revisar la lluvia de Galápagos: ${(error as Error).message}`);
    } finally {
      this.checking = false;
    }
  }

  private async notify(station: GalapagosStationRain, now: Date): Promise<void> {
    // Lluvia de alarma con el mar alto: emergencia por la marea, con su propio aviso.
    const highSea = station.level === 'alarm' && station.scenario === 'emergency';
    const alertKey = `galapagos-rain:${station.code}:${station.level}${highSea ? '-sea' : ''}:${dayFormat.format(now)}`;
    const subject = highSea
      ? `Emergencia por lluvia con el mar alto en ${station.island}`
      : `${station.level === 'extreme' ? 'Alarma extrema' : 'Alarma'} de lluvia en ${station.island}`;
    const message = this.withMapLink(galapagosAlertMessage(station));
    this.logger.log(`${subject}: ${station.mm5h} mm en 5 h, ${station.mm3h} mm en 3 h (${station.code})`);

    let sent = 0;
    let attempted = 0;
    for (const chat of await this.chats.listActive()) {
      if (!chat.active || !wantsGalapagos(chat, station.cantonCode)) continue;
      if (await this.deliveries.wasSent(alertKey, CHANNEL, chat.chatId)) continue;
      attempted++;
      const error = await this.send(chat, message, subject);
      if (!error) sent++;
      await this.deliveries.record(
        Object.assign(new NotificationDeliveryEntity(), {
          alertKey,
          eventId: null,
          subscriberId: null,
          recipient: chat.chatId,
          channel: CHANNEL,
          subject,
          status: error ? 'failed' : 'sent',
          error,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
    }
    if (attempted > 0) this.logger.log(`${subject}: ${sent} de ${attempted} chats`);
  }

  /** null si se envió; si no, el motivo. */
  private async send(chat: TelegramChatEntity, message: TelegramMessage, subject: string): Promise<string | null> {
    try {
      await this.telegram.send(chat.chatId, message);
      return null;
    } catch (caught) {
      const error = (caught as Error).message || 'error desconocido';
      this.logger.error(`No se pudo enviar "${subject}" al chat ${chat.chatId}: ${error}`);
      // 403: la persona bloqueó el bot o eliminó su cuenta.
      if (caught instanceof TelegramError && caught.code === 403) await this.chats.save(Object.assign(chat, { active: false }));
      return error;
    }
  }

  private withMapLink(message: TelegramMessage): TelegramMessage {
    const url = this.config.get('APP_PUBLIC_URL');
    if (!url) return message;
    return { ...message, text: `${message.text}\n\n🗺️ Mapa: ${escapeHtml(url)}`, link: { label: 'Ver en el mapa', url } };
  }
}
