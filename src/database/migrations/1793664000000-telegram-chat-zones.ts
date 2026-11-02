import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Zonas de planificación elegidas por cada persona para sus alertas (vacío = ninguna). */
export class TelegramChatZones1793664000000 implements MigrationInterface {
  name = 'TelegramChatZones1793664000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE telegram_chats ADD COLUMN zones integer[] NOT NULL DEFAULT '{}'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE telegram_chats DROP COLUMN zones');
  }
}
