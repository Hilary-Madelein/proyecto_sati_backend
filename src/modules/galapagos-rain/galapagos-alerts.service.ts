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
import { GALAPAGOS_PROVINCE, LEVEL_RANK, type GalapagosLevel } from './galapagos-rain.js';
import { GalapagosRainService, type GalapagosStationRain } from './galapagos-rain.service.js';

const CHANNEL = 'telegram';
/** Las estaciones publican un dato por hora y se recargan cada 10 minutos. */
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
 * Vigila la lluvia de las dos estaciones de Galápagos y avisa por Telegram cuando
 * una sube de nivel (a alarma o a alarma extrema). Mientras siga en el mismo nivel
 * no repite; el historial de envíos evita repetir tras un reinicio el mismo día.
 * Nunca lanza errores hacia afuera.
 */
@Injectable()
export class GalapagosAlertsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GalapagosAlertsService.name);
  /** Nivel de cada estación en la revisión anterior. */
  private readonly levels = new Map<string, GalapagosLevel>();
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
        const before = this.levels.get(station.code) ?? 'normal';
        this.levels.set(station.code, station.level);
        if (LEVEL_RANK[station.level] > LEVEL_RANK[before]) await this.notify(station, now);
      }
    } catch (error) {
      this.logger.error(`No se pudo revisar la lluvia de Galápagos: ${(error as Error).message}`);
    } finally {
      this.checking = false;
    }
  }

  private async notify(station: GalapagosStationRain, now: Date): Promise<void> {
    const alertKey = `galapagos-rain:${station.code}:${station.level}:${dayFormat.format(now)}`;
    const subject = `${station.level === 'extreme' ? 'Alarma extrema' : 'Alarma'} de lluvia en ${station.island}`;
    const message = this.withMapLink(galapagosAlertMessage(station));
    this.logger.log(`${subject}: ${station.mm24h} mm en 24 h, ${station.mm3h} mm en 3 h (${station.code})`);

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
