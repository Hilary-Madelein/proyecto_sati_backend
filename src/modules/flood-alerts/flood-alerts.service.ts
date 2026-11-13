import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { escapeHtml } from '../../common/text/escape-html.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { TelegramClient, TelegramError, type TelegramMessage } from '../../integrations/telegram/telegram.client.js';
import { CantonAnalysisService, type ParishAlert } from '../canton-analysis/canton-analysis.service.js';
import { FloodHubService } from '../flood-hub/flood-hub.service.js';
import type { FlashFloodArea } from '../flood-hub/flood-hub-source.js';
import { NotificationDeliveryEntity } from '../notifications/entities/notification-delivery.entity.js';
import { DeliveryStore } from '../notifications/notification-stores.js';
import { WeatherStationsService, type StationRain } from '../weather-stations/weather-stations.service.js';
import { CantonCatalog } from './canton-catalog.js';
import { withCantonRain } from './canton-rain.js';
import { FlashFloodIssueEntity } from './entities/flash-flood-issue.entity.js';
import type { TelegramChatEntity } from './entities/telegram-chat.entity.js';
import { cantonsInZones, type CantonForecast } from './flash-flood-cantons.js';
import { applyExpiry, applyIssue, type IssueChanges } from './flash-flood-transitions.js';
import { EXPLORE, type ExplorerData } from './flood-alert-explorer.js';
import { filterToScope, type ChatScope } from './flood-alert-scope.js';
import { FlashFloodIssueStore, TelegramChatStore } from './flood-alert-stores.js';
import { improvedMessage, statusMessage, worsenedMessage, type AlertCanton } from './flood-alert-messages.js';
import { ANALYZE_BUTTON } from './situation-message.js';

const CHANNEL = 'telegram';
/** Cada cuánto se revisa. Flood Hub tiene su propio caché de 30 minutos. */
const CHECK_MS = 5 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
/** Pausa entre envíos: Telegram admite unos 30 mensajes por segundo. */
const SEND_GAP_MS = 50;
/** La lluvia acompaña a la alerta: si tarda más que esto, la alerta sale sin ella. */
const RAIN_TIMEOUT_MS = 20_000;

/** Botones de cada alerta: el detalle por zona, provincia, cantón y parroquia, y el análisis de la situación. */
const DETAIL_BUTTON = [[{ label: '🔎 Más detalle', data: EXPLORE }], [ANALYZE_BUTTON]];
/** Sin riesgo vigente no hay detalle que abrir, pero el análisis sí se puede pedir. */
const ANALYZE_ONLY = [[ANALYZE_BUTTON]];

interface RainSources {
  parishes: ParishAlert[];
  stations: StationRain[];
}

const latestTime = (areas: readonly FlashFloodArea[], field: 'issuedAt' | 'validUntil') =>
  new Date(Math.max(...areas.map((area) => Date.parse(area[field]))));

/**
 * Vigila las crecidas repentinas de Google y avisa por Telegram a quienes
 * entraron con el enlace. Solo actúa ante una emisión nueva: si la consulta falla
 * o devuelve lo mismo, no cambia nada. Nunca lanza errores hacia afuera.
 */
@Injectable()
export class FloodAlertsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FloodAlertsService.name);
  private firstCheck?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    private readonly floodHub: FloodHubService,
    private readonly telegram: TelegramClient,
    private readonly chats: TelegramChatStore,
    private readonly issues: FlashFloodIssueStore,
    private readonly deliveries: DeliveryStore,
    private readonly catalog: CantonCatalog,
    private readonly analysis: CantonAnalysisService,
    private readonly stations: WeatherStationsService,
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

  /** Revisa si hay una emisión nueva y avisa de lo que cambió. */
  async check(now = new Date()): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const snapshot = await this.floodHub.snapshot();
      if (snapshot.isStale || !snapshot.flashFloods) return;
      const zones = snapshot.flashFloods.filter((zone) => Date.parse(zone.validUntil) > now.getTime());
      const latest = await this.issues.latest();

      if (zones.length === 0) {
        if (latest && latest.cantons.length > 0 && latest.validUntil <= now) await this.processExpiry(latest);
        return;
      }
      const issuedAt = latestTime(zones, 'issuedAt');
      if (latest && issuedAt <= latest.issuedAt) return;
      await this.processIssue(issuedAt, zones, latest);
    } catch (error) {
      this.logger.error(`No se pudieron revisar las crecidas de Google: ${(error as Error).message}`);
    } finally {
      this.checking = false;
    }
  }

  /** Lo vigente dentro de lo que eligió la persona, para /estado y al elegir. */
  async currentStatus(scope: ChatScope): Promise<TelegramMessage> {
    const latest = await this.issues.latest();
    const cantons = await this.withRain(filterToScope(scope, latest?.cantons ?? []), latest?.zones ?? []);
    return this.withMapLink({
      text: statusMessage(cantons, latest?.validUntil ?? null, scope),
      silent: true,
      buttons: cantons.length > 0 && latest ? DETAIL_BUTTON : ANALYZE_ONLY,
    });
  }

  /** Lo vigente dentro de lo elegido, con todo lo necesario para "Más detalle". */
  async explorerData(scope: ChatScope): Promise<ExplorerData> {
    const latest = await this.issues.latest();
    const zones = latest?.zones ?? [];
    const [sources, parishes, provinces] = await Promise.all([this.loadRain(), this.catalog.parishes(), this.catalog.provinces()]);
    const cantons = filterToScope(scope, latest?.cantons ?? []);
    return {
      cantons: sources ? withCantonRain(cantons, zones, sources.parishes, sources.stations) : cantons,
      validUntil: latest?.validUntil ?? null,
      zones,
      parishes,
      forecasts: sources?.parishes ?? [],
      provinces,
    };
  }

  private async processIssue(issuedAt: Date, zones: FlashFloodArea[], latest: FlashFloodIssueEntity | null): Promise<void> {
    const current = cantonsInZones(zones, await this.catalog.parishes());
    const changes = applyIssue(latest?.cantons ?? [], current);
    const validUntil = latestTime(zones, 'validUntil');
    this.logger.log(
      `Emisión de Google ${issuedAt.toISOString()}: ${current.length} cantones · ${changes.worsened.length} empeoran · ${changes.lowered.length} bajan · ${changes.left.length} salen`,
    );
    await this.notify(issuedAt, validUntil, changes, zones);
    await this.issues.save(Object.assign(new FlashFloodIssueEntity(), { issuedAt, validUntil, zones, cantons: changes.watched }));
  }

  private async processExpiry(latest: FlashFloodIssueEntity): Promise<void> {
    const changes = applyExpiry(latest.cantons);
    this.logger.log(`Terminó la vigencia de la emisión ${latest.issuedAt.toISOString()}: ${changes.left.length} cantones salen`);
    await this.notify(latest.validUntil, latest.validUntil, changes, latest.zones);
    await this.issues.save(Object.assign(latest, { cantons: changes.watched }));
  }

  private async notify(issuedAt: Date, validUntil: Date, changes: IssueChanges, zones: readonly FlashFloodArea[]): Promise<void> {
    const key = `flash-flood:${issuedAt.toISOString()}`;
    const chats = await this.chats.listActive();
    const worsenedWithRain = chats.length > 0 ? await this.withRain(changes.worsened, zones) : [];
    await this.broadcast(chats, `${key}:worsened`, 'Riesgo de crecida repentina', (chat) => {
      const worsened = filterToScope(chat, worsenedWithRain);
      if (worsened.length === 0) return null;
      return {
        text: worsenedMessage(worsened, validUntil, chat),
        silent: !worsened.some((canton) => canton.likelihood === 'highly_likely'),
        buttons: DETAIL_BUTTON,
      };
    });
    await this.broadcast(chats, `${key}:improved`, 'Actualización de crecidas', (chat) => {
      const lowered = filterToScope(chat, changes.lowered);
      const left = filterToScope(chat, changes.left);
      if (lowered.length === 0 && left.length === 0) return null;
      return { text: improvedMessage({ lowered, left }, chat), silent: true, buttons: ANALYZE_ONLY };
    });
  }

  /** Agrega la lluvia a los cantones. Nunca frena una alerta: si no se puede leer, sale sin cifras. */
  private async withRain(cantons: readonly CantonForecast[], zones: readonly FlashFloodArea[]): Promise<AlertCanton[]> {
    if (cantons.length === 0) return [];
    const sources = await this.loadRain();
    return sources ? withCantonRain(cantons, zones, sources.parishes, sources.stations) : [...cantons];
  }

  /** Pronóstico por parroquia y lluvia medida; null si no responden a tiempo. */
  private async loadRain(): Promise<RainSources | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sin respuesta en ${RAIN_TIMEOUT_MS / 1000} s`)), RAIN_TIMEOUT_MS);
      });
      const [analysis, stations] = await Promise.race([Promise.all([this.analysis.snapshot(), this.stations.snapshot()]), timeout]);
      return { parishes: analysis.parishes, stations: stations.stations };
    } catch (error) {
      this.logger.warn(`Sin datos de lluvia: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A cada chat, en serie, lo que le toca según lo que eligió (null = nada). El
   * historial evita repetir tras un reinicio a medio envío.
   */
  private async broadcast(
    chats: TelegramChatEntity[],
    alertKey: string,
    subject: string,
    messageFor: (chat: TelegramChatEntity) => TelegramMessage | null,
  ): Promise<void> {
    let sent = 0;
    let attempted = 0;
    for (const chat of chats) {
      const message = chat.active ? messageFor(chat) : null;
      if (!message || (await this.deliveries.wasSent(alertKey, CHANNEL, chat.chatId))) continue;
      attempted++;
      let error: string | null = null;
      try {
        await this.telegram.send(chat.chatId, this.withMapLink(message));
        sent++;
      } catch (caught) {
        error = (caught as Error).message || 'error desconocido';
        this.logger.error(`No se pudo enviar "${subject}" al chat ${chat.chatId}: ${error}`);
        // 403: la persona bloqueó el bot o eliminó su cuenta.
        if (caught instanceof TelegramError && caught.code === 403) await this.chats.save(Object.assign(chat, { active: false }));
      }
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

  /** Botón al mapa, y la dirección también en el texto: al copiar o reenviar una alerta, el botón puede perderse. */
  private withMapLink(message: TelegramMessage): TelegramMessage {
    const url = this.config.get('APP_PUBLIC_URL');
    if (!url) return message;
    return { ...message, text: `${message.text}

🗺️ Mapa: ${escapeHtml(url)}`, link: { label: 'Ver en el mapa', url } };
  }
}
