import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza el río desbordado y el impacto calculado (EventFloodDetails) por lo
 * que la SNGR registra: si hubo daño y cuántos damnificados. Los valores se
 * llenan en la siguiente sincronización.
 */
export class EventDamage1792022400000 implements MigrationInterface {
  name = 'EventDamage1792022400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE hazard_events
        DROP COLUMN water_body,
        DROP COLUMN impact_level,
        ADD COLUMN has_damage boolean NOT NULL DEFAULT false,
        ADD COLUMN homeless   integer NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE hazard_events
        DROP COLUMN homeless,
        DROP COLUMN has_damage,
        ADD COLUMN water_body   varchar(120),
        ADD COLUMN impact_level varchar(8)
    `);
  }
}
