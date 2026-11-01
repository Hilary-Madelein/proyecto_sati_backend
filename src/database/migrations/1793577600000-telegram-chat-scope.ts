import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Qué alertas eligió cada persona: las provincias y cantones marcados; sin ninguno, todo el país. */
export class TelegramChatScope1793577600000 implements MigrationInterface {
  name = 'TelegramChatScope1793577600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE telegram_chats
        ADD COLUMN provinces text[] NOT NULL DEFAULT '{}',
        ADD COLUMN cantons   jsonb  NOT NULL DEFAULT '[]'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE telegram_chats
        DROP COLUMN cantons,
        DROP COLUMN provinces
    `);
  }
}
