import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { TelegramClient, TelegramError, type TelegramUpdate } from '../../integrations/telegram/telegram.client.js';
import { TelegramChatEntity } from './entities/telegram-chat.entity.js';
import { TelegramChatStore } from './flood-alert-stores.js';
import { FloodAlertsService } from './flood-alerts.service.js';

/** Pausa tras un error de red, y tras un 409 (otro proceso lee con el mismo token). */
const ERROR_PAUSE_MS = 10_000;
const CONFLICT_PAUSE_MS = 60_000;

const HELP = 'Comandos:\n/estado: zonas de riesgo vigentes\n/parar: dejar de recibir alertas';

type ChatMessage = NonNullable<TelegramUpdate['message']>;

/**
 * Atiende el bot: quien abre el enlace de invitación queda registrado con su
 * chat id. Lee con long polling, que no necesita una dirección pública y funciona
 * igual en local que en el servidor, siempre que un solo proceso use el token.
 */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly stop = new AbortController();
  private offset = 0;

  constructor(
    private readonly telegram: TelegramClient,
    private readonly chats: TelegramChatStore,
    private readonly alerts: FloodAlertsService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.telegram.enabled) return;
    void this.telegram
      .setCommands([
        { command: 'estado', description: 'Zonas de riesgo vigentes' },
        { command: 'parar', description: 'Dejar de recibir alertas' },
      ])
      .catch((error: Error) => this.logger.warn(`No se pudieron publicar los comandos: ${error.message}`));
    void this.poll();
  }

  onApplicationShutdown(): void {
    this.stop.abort();
  }

  private async poll(): Promise<void> {
    while (!this.stop.signal.aborted) {
      try {
        for (const update of await this.telegram.getUpdates(this.offset, this.stop.signal)) {
          // Se confirma aunque falle: un mensaje que siempre falla no debe trabar a los demás.
          this.offset = update.update_id + 1;
          await this.handle(update).catch((error: Error) => this.logger.error(`No se pudo atender un mensaje: ${error.message}`));
        }
      } catch (error) {
        if (this.stop.signal.aborted) return;
        const conflict = error instanceof TelegramError && error.code === 409;
        if (conflict) this.logger.warn('Otro proceso está leyendo el bot con el mismo token');
        else this.logger.warn(`No se pudo leer Telegram: ${(error as Error).message}`);
        await new Promise((resolve) => setTimeout(resolve, conflict ? CONFLICT_PAUSE_MS : ERROR_PAUSE_MS));
      }
    }
  }

  /** Atiende una novedad. Solo chats privados. */
  async handle(update: TelegramUpdate): Promise<void> {
    const membership = update.my_chat_member;
    if (membership?.chat.type === 'private' && ['kicked', 'left'].includes(membership.new_chat_member.status)) {
      await this.setActive(String(membership.chat.id), false);
      return;
    }

    const message = update.message;
    if (message?.chat.type !== 'private' || !message.text) return;
    const chatId = String(message.chat.id);
    const [command, argument] = message.text.trim().split(/\s+/);
    switch (command) {
      case '/start':
        return this.start(chatId, argument, message);
      case '/parar':
        await this.setActive(chatId, false);
        return this.telegram.send(chatId, { text: 'Listo, no recibirás más alertas. Para volver, abre de nuevo el enlace.' });
      case '/estado':
        return this.status(chatId);
      default:
        return this.telegram.send(chatId, { text: HELP });
    }
  }

  private async start(chatId: string, code: string | undefined, message: ChatMessage): Promise<void> {
    // Quien ya entró con el enlace puede volver sin él, por ejemplo tras desbloquear el bot.
    const known = await this.chats.find(chatId);
    if (!known && code !== this.config.get('TELEGRAM_INVITE_CODE')) {
      return this.telegram.send(chatId, { text: 'Este bot es solo para quienes participan en la prueba. Usa el enlace de invitación que recibiste.' });
    }
    await this.chats.save(
      Object.assign(known ?? new TelegramChatEntity(), {
        chatId,
        firstName: message.from?.first_name?.slice(0, 120) ?? null,
        username: message.from?.username?.slice(0, 64) ?? null,
        active: true,
      }),
    );
    this.logger.log(`Chat ${known ? 'reactivado' : 'registrado'}: ${chatId}`);
    await this.telegram.send(chatId, {
      text: `Quedaste registrado en la prueba de alertas de SATI: te avisaremos cuando Google marque riesgo de crecida repentina en un cantón.\n\n${HELP}`,
    });
    await this.telegram.send(chatId, await this.alerts.currentStatus());
  }

  private async status(chatId: string): Promise<void> {
    const chat = await this.chats.find(chatId);
    if (!chat?.active) return this.telegram.send(chatId, { text: 'No estás registrado. Usa el enlace de invitación que recibiste.' });
    await this.telegram.send(chatId, await this.alerts.currentStatus());
  }

  private async setActive(chatId: string, active: boolean): Promise<void> {
    const chat = await this.chats.find(chatId);
    if (chat) await this.chats.save(Object.assign(chat, { active }));
  }
}
