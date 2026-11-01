import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { escapeHtml } from '../../common/text/escape-html.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { TelegramClient, TelegramError, type TelegramMessage } from '../../integrations/telegram/telegram.client.js';
import { loadParishes, type ParishPoint } from '../canton-analysis/parishes.js';
import { FloodHubService } from '../flood-hub/flood-hub.service.js';
import type { FlashFloodArea } from '../flood-hub/flood-hub-source.js';
import { NotificationDeliveryEntity } from '../notifications/entities/notification-delivery.entity.js';
import { DeliveryStore } from '../notifications/notification-stores.js';
import { FlashFloodIssueEntity } from './entities/flash-flood-issue.entity.js';
import { cantonsInZones } from './flash-flood-cantons.js';
import { applyExpiry, applyIssue, type IssueChanges } from './flash-flood-transitions.js';
import { FlashFloodIssueStore, TelegramChatStore } from './flood-alert-stores.js';
import { improvedMessage, statusMessage, worsenedMessage } from './flood-alert-messages.js';

const CHANNEL = 'telegram';
/** Cada cuánto se revisa. Flood Hub tiene su propio caché de 30 minutos. */
const CHECK_MS = 5 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
/** Pausa entre envíos: Telegram admite unos 30 mensajes por segundo. */
const SEND_GAP_MS = 50;

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
  private parishes: Promise<ParishPoint[]> | null = null;

  constructor(
    private readonly floodHub: FloodHubService,
    private readonly telegram: TelegramClient,
    private readonly chats: TelegramChatStore,
    private readonly issues: FlashFloodIssueStore,
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

  /** Lo vigente, para quien recién entra y para /estado. */
  async currentStatus(): Promise<TelegramMessage> {
    const latest = await this.issues.latest();
    return this.withMapLink({ text: statusMessage(latest?.cantons ?? [], latest?.validUntil ?? null), silent: true });
  }

  private async processIssue(issuedAt: Date, zones: FlashFloodArea[], latest: FlashFloodIssueEntity | null): Promise<void> {
    this.parishes ??= loadParishes();
    const current = cantonsInZones(zones, await this.parishes);
    const changes = applyIssue(latest?.cantons ?? [], current);
    const validUntil = latestTime(zones, 'validUntil');
    this.logger.log(
      `Emisión de Google ${issuedAt.toISOString()}: ${current.length} cantones · ${changes.worsened.length} empeoran · ${changes.lowered.length} bajan · ${changes.left.length} salen`,
    );
    await this.notify(issuedAt, validUntil, changes);
    await this.issues.save(Object.assign(new FlashFloodIssueEntity(), { issuedAt, validUntil, zones, cantons: changes.watched }));
  }

  private async processExpiry(latest: FlashFloodIssueEntity): Promise<void> {
    const changes = applyExpiry(latest.cantons);
    this.logger.log(`Terminó la vigencia de la emisión ${latest.issuedAt.toISOString()}: ${changes.left.length} cantones salen`);
    await this.notify(latest.validUntil, latest.validUntil, changes);
    await this.issues.save(Object.assign(latest, { cantons: changes.watched }));
  }

  private async notify(issuedAt: Date, validUntil: Date, changes: IssueChanges): Promise<void> {
    const key = `flash-flood:${issuedAt.toISOString()}`;
    if (changes.worsened.length > 0) {
      const urgent = changes.worsened.some((canton) => canton.likelihood === 'highly_likely');
      await this.broadcast(`${key}:worsened`, 'Riesgo de crecida repentina', {
        text: worsenedMessage(changes.worsened, validUntil),
        silent: !urgent,
      });
    }
    if (changes.lowered.length > 0 || changes.left.length > 0) {
      await this.broadcast(`${key}:improved`, 'Actualización de crecidas', { text: improvedMessage(changes), silent: true });
    }
  }

  /** A todos los chats activos, en serie. El historial evita repetir tras un reinicio a medio envío. */
  private async broadcast(alertKey: string, subject: string, message: TelegramMessage): Promise<void> {
    const withLink = this.withMapLink(message);
    const chats = await this.chats.listActive();
    let sent = 0;
    for (const chat of chats) {
      if (await this.deliveries.wasSent(alertKey, CHANNEL, chat.chatId)) continue;
      let error: string | null = null;
      try {
        await this.telegram.send(chat.chatId, withLink);
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
    this.logger.log(`${subject}: ${sent} de ${chats.length} chats`);
  }

  /** Botón al mapa, y la dirección también en el texto: al copiar o reenviar una alerta, el botón puede perderse. */
  private withMapLink(message: TelegramMessage): TelegramMessage {
    const url = this.config.get('APP_PUBLIC_URL');
    if (!url) return message;
    return { ...message, text: `${message.text}

🗺️ Mapa: ${escapeHtml(url)}`, link: { label: 'Ver en el mapa', url } };
  }
}
