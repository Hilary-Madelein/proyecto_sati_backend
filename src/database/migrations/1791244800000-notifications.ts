import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Suscriptores de alertas por correo e historial de envíos. */
export class Notifications1791244800000 implements MigrationInterface {
  name = 'Notifications1791244800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_subscribers (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name         varchar(120) NOT NULL,
        email        varchar(254) NOT NULL,
        provinces    text[]       NOT NULL DEFAULT '{}',
        min_severity varchar(16)  NOT NULL DEFAULT 'high',
        active       boolean      NOT NULL DEFAULT true,
        created_at   timestamptz  NOT NULL DEFAULT now(),
        updated_at   timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT uq_notification_subscribers_email UNIQUE (email),
        CONSTRAINT ck_notification_subscribers_min_severity CHECK (min_severity IN ('critical', 'high'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE notification_deliveries (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        alert_key     varchar(160) NOT NULL,
        event_id      uuid,
        subscriber_id uuid REFERENCES notification_subscribers (id) ON DELETE SET NULL,
        recipient     varchar(254) NOT NULL,
        channel       varchar(32)  NOT NULL,
        subject       varchar(255) NOT NULL,
        status        varchar(16)  NOT NULL,
        error         text,
        created_at    timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT ck_notification_deliveries_status CHECK (status IN ('sent', 'failed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_notification_deliveries_alert ON notification_deliveries (alert_key, channel, recipient)`,
    );
    await queryRunner.query(`CREATE INDEX ix_notification_deliveries_created_at ON notification_deliveries (created_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notification_deliveries`);
    await queryRunner.query(`DROP TABLE notification_subscribers`);
  }
}
