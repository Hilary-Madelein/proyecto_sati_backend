import type { FlashFloodIssueEntity } from './entities/flash-flood-issue.entity.js';
import type { TelegramChatEntity } from './entities/telegram-chat.entity.js';

/** Contratos de almacenamiento: implementación en memoria y en PostgreSQL (ver `src/storage/`). */
export abstract class TelegramChatStore {
  abstract find(chatId: string): Promise<TelegramChatEntity | null>;
  abstract listActive(): Promise<TelegramChatEntity[]>;
  abstract save(chat: TelegramChatEntity): Promise<TelegramChatEntity>;
}

export abstract class FlashFloodIssueStore {
  /** La emisión más reciente, o null si aún no hay ninguna. */
  abstract latest(): Promise<FlashFloodIssueEntity | null>;
  /** Crea o reemplaza por `issuedAt`. */
  abstract save(issue: FlashFloodIssueEntity): Promise<void>;
}
