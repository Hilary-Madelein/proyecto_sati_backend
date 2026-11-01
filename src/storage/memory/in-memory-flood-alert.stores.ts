import { Injectable, Optional } from '@nestjs/common';
import { FlashFloodIssueEntity } from '../../modules/flood-alerts/entities/flash-flood-issue.entity.js';
import { TelegramChatEntity } from '../../modules/flood-alerts/entities/telegram-chat.entity.js';
import { NATIONAL } from '../../modules/flood-alerts/flood-alert-scope.js';
import { FlashFloodIssueStore, TelegramChatStore } from '../../modules/flood-alerts/flood-alert-stores.js';
import { JsonFilePersistence } from './json-file-persistence.js';

const CHATS = 'telegram-chats';
const ISSUES = 'flash-flood-issues';
/** El archivo en memoria guarda solo las últimas emisiones. */
const MAX_ISSUES = 500;

type StoredChat = Omit<TelegramChatEntity, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };
type StoredIssue = Omit<FlashFloodIssueEntity, 'issuedAt' | 'validUntil' | 'createdAt'> & {
  issuedAt: string;
  validUntil: string;
  createdAt: string;
};

@Injectable()
export class InMemoryTelegramChatStore extends TelegramChatStore {
  private readonly chats = new Map<string, TelegramChatEntity>();

  constructor(@Optional() private readonly persistence?: JsonFilePersistence) {
    super();
    for (const stored of persistence?.load<StoredChat[]>(CHATS) ?? []) {
      this.chats.set(
        stored.chatId,
        // Quien se registró antes de poder elegir queda en todo el país.
        Object.assign(new TelegramChatEntity(), NATIONAL, stored, { createdAt: new Date(stored.createdAt), updatedAt: new Date(stored.updatedAt) }),
      );
    }
  }

  async find(chatId: string): Promise<TelegramChatEntity | null> {
    return this.chats.get(chatId) ?? null;
  }

  async listActive(): Promise<TelegramChatEntity[]> {
    return [...this.chats.values()].filter((chat) => chat.active);
  }

  async save(chat: TelegramChatEntity): Promise<TelegramChatEntity> {
    const now = new Date();
    chat.createdAt ??= now;
    chat.updatedAt = now;
    this.chats.set(chat.chatId, chat);
    this.persistence?.save(CHATS, () => [...this.chats.values()]);
    return chat;
  }
}

@Injectable()
export class InMemoryFlashFloodIssueStore extends FlashFloodIssueStore {
  /** De la más reciente a la más antigua. */
  private issues: FlashFloodIssueEntity[] = [];

  constructor(@Optional() private readonly persistence?: JsonFilePersistence) {
    super();
    this.issues = (persistence?.load<StoredIssue[]>(ISSUES) ?? []).map((stored) =>
      Object.assign(new FlashFloodIssueEntity(), stored, {
        issuedAt: new Date(stored.issuedAt),
        validUntil: new Date(stored.validUntil),
        createdAt: new Date(stored.createdAt),
      }),
    );
  }

  async latest(): Promise<FlashFloodIssueEntity | null> {
    return this.issues[0] ?? null;
  }

  async save(issue: FlashFloodIssueEntity): Promise<void> {
    issue.createdAt ??= new Date();
    const others = this.issues.filter((known) => known.issuedAt.getTime() !== issue.issuedAt.getTime());
    this.issues = [issue, ...others].sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime()).slice(0, MAX_ISSUES);
    this.persistence?.save(ISSUES, () => this.issues);
  }
}
