import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FlashFloodIssueEntity } from '../../modules/flood-alerts/entities/flash-flood-issue.entity.js';
import { TelegramChatEntity } from '../../modules/flood-alerts/entities/telegram-chat.entity.js';
import { FlashFloodIssueStore, TelegramChatStore } from '../../modules/flood-alerts/flood-alert-stores.js';

@Injectable()
export class TypeOrmTelegramChatStore extends TelegramChatStore {
  constructor(@InjectRepository(TelegramChatEntity) private readonly repository: Repository<TelegramChatEntity>) {
    super();
  }

  find(chatId: string): Promise<TelegramChatEntity | null> {
    return this.repository.findOneBy({ chatId });
  }

  listActive(): Promise<TelegramChatEntity[]> {
    return this.repository.find({ where: { active: true } });
  }

  save(chat: TelegramChatEntity): Promise<TelegramChatEntity> {
    return this.repository.save(chat);
  }
}

@Injectable()
export class TypeOrmFlashFloodIssueStore extends FlashFloodIssueStore {
  constructor(@InjectRepository(FlashFloodIssueEntity) private readonly repository: Repository<FlashFloodIssueEntity>) {
    super();
  }

  async latest(): Promise<FlashFloodIssueEntity | null> {
    const [issue] = await this.repository.find({ order: { issuedAt: 'DESC' }, take: 1 });
    return issue ?? null;
  }

  async save(issue: FlashFloodIssueEntity): Promise<void> {
    await this.repository.save(issue);
  }
}
