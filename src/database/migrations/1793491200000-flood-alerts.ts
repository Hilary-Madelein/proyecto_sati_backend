import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Prueba de alertas de crecidas por Telegram: chats registrados y archivo de emisiones de Google. */
export class FloodAlerts1793491200000 implements MigrationInterface {
  name = 'FloodAlerts1793491200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE telegram_chats (
        chat_id    varchar(32) PRIMARY KEY,
        first_name varchar(120),
        username   varchar(64),
        active     boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE flash_flood_issues (
        issued_at   timestamptz PRIMARY KEY,
        valid_until timestamptz NOT NULL,
        zones       jsonb NOT NULL,
        cantons     jsonb NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE flash_flood_issues');
    await queryRunner.query('DROP TABLE telegram_chats');
  }
}
