import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Río desbordado e impacto de cada evento (inundaciones de la SNGR). */
export class EventFloodDetails1791936000000 implements MigrationInterface {
  name = 'EventFloodDetails1791936000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE hazard_events
        ADD COLUMN water_body   varchar(120),
        ADD COLUMN impact_level varchar(8)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE hazard_events DROP COLUMN impact_level, DROP COLUMN water_body`);
  }
}
