import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';

const API_URL = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;
/** Espera larga de getUpdates: Telegram responde apenas llega algo, o vacío al cumplirse. */
const POLL_SECONDS = 30;
/** Límite de Telegram para el texto de un mensaje. */
const MAX_TEXT = 4096;

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: TelegramChat; from?: { first_name?: string; username?: string } };
  /** Cambios del bot en un chat: en uno privado, que la persona lo bloqueó o desbloqueó. */
  my_chat_member?: { chat: TelegramChat; new_chat_member: { status: string } };
  /** Tocaron un botón de un mensaje. */
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: TelegramChat } };
}

/** Botón de opción: al tocarlo, Telegram devuelve `data` (máximo 64 bytes). */
export interface TelegramButton {
  label: string;
  data: string;
}

export interface TelegramMessage {
  /** HTML de Telegram: lo dinámico debe ir escapado. */
  text: string;
  /** Llega sin sonido. */
  silent?: boolean;
  /** Botón con enlace debajo del mensaje. Telegram rechaza direcciones de localhost. */
  link?: { label: string; url: string };
  /** Filas de botones de opción. */
  buttons?: TelegramButton[][];
}

const toKeyboard = (buttons: TelegramButton[][]) =>
  buttons.map((row) => row.map(({ label, data }) => ({ text: label, callback_data: data })));

/** Botones de opción y, debajo, el enlace: los dos en un mismo teclado. */
function keyboardOf({ buttons = [], link }: TelegramMessage) {
  const rows = [...toKeyboard(buttons), ...(link ? [[{ text: link.label, url: link.url }]] : [])];
  return rows.length > 0 ? { reply_markup: { inline_keyboard: rows } } : {};
}

/** Error de la API de Telegram. Nunca incluye el token: va en la URL, que no se registra. */
export class TelegramError extends Error {
  constructor(
    message: string,
    /** Código de Telegram: 403 = bloqueó el bot; 409 = otro proceso lee con el mismo token; 429 = demasiados envíos. */
    readonly code: number,
    /** Segundos a esperar, si Telegram los indica (429). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Cliente mínimo de la API de bots de Telegram. */
@Injectable()
export class TelegramClient {
  private readonly token: string | undefined;

  constructor(config: AppConfigService) {
    this.token = config.get('TELEGRAM_BOT_TOKEN');
  }

  /** false = sin TELEGRAM_BOT_TOKEN: las alertas por Telegram no se encienden. */
  get enabled(): boolean {
    return Boolean(this.token);
  }

  /** Novedades desde `offset`. Con `signal` se puede cortar la espera al apagar. */
  getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: POLL_SECONDS, allowed_updates: ['message', 'my_chat_member', 'callback_query'] },
      { signal, timeoutMs: (POLL_SECONDS + 10) * 1000 },
    );
  }

  async setCommands(commands: { command: string; description: string }[]): Promise<void> {
    await this.call('setMyCommands', { commands });
  }

  /** Envía el mensaje, partido por líneas si no cabe en uno. Si Telegram pide esperar, espera y reintenta una vez. */
  async send(chatId: string, message: TelegramMessage): Promise<void> {
    const parts = splitText(message.text);
    for (const [index, text] of parts.entries()) {
      const isLast = index === parts.length - 1;
      await this.withRetry(() =>
        this.call('sendMessage', {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_notification: message.silent ?? false,
          link_preview_options: { is_disabled: true },
          ...(isLast && keyboardOf(message)),
        }),
      );
    }
  }

  /** Quita el "cargando" del botón que tocaron. */
  async answerCallback(id: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id });
  }

  /** Reemplaza el texto y los botones de un mensaje; sin `buttons`, los quita. */
  async editMessage(chatId: string, messageId: number, text: string, buttons?: TelegramButton[][]): Promise<void> {
    try {
      await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...(buttons && { reply_markup: { inline_keyboard: toKeyboard(buttons) } }),
      });
    } catch (error) {
      // Dos toques al mismo botón: el mensaje ya dice eso.
      if (!(error instanceof TelegramError && error.message.includes('message is not modified'))) throw error;
    }
  }

  private async withRetry(send: () => Promise<unknown>): Promise<void> {
    try {
      await send();
    } catch (error) {
      if (!(error instanceof TelegramError) || error.retryAfter === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, error.retryAfter! * 1000));
      await send();
    }
  }

  private async call<T>(method: string, body: object, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const response = await fetch(`${API_URL}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    const json = (await response.json()) as {
      ok: boolean;
      result: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    if (!json.ok) {
      throw new TelegramError(
        json.description ?? `Telegram respondió ${response.status}`,
        json.error_code ?? response.status,
        json.parameters?.retry_after,
      );
    }
    return json.result;
  }
}

/**
 * Parte el texto en trozos que Telegram acepta. Corta entre bloques (separados por
 * una línea en blanco): cada uno debe ser HTML completo, porque una etiqueta sin
 * cerrar hace que Telegram rechace el mensaje.
 */
export function splitText(text: string, limit = MAX_TEXT): string[] {
  const parts: string[] = [];
  let current = '';
  for (const block of text.split('\n\n')) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > limit && current) {
      parts.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}
