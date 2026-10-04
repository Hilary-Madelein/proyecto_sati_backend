import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1790985600000 implements MigrationInterface {
  name = 'InitialSchema1790985600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE hazard_events (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source          varchar(32)  NOT NULL,
        external_id     varchar(64)  NOT NULL,
        code            varchar(64),
        hazard_type     varchar(32)  NOT NULL,
        severity        varchar(16)  NOT NULL,
        level           smallint,
        status          varchar(16)  NOT NULL,
        title           varchar(255) NOT NULL,
        description     text,
        province        varchar(120),
        canton          varchar(120),
        sector          varchar(255),
        location        geography(Point, 4326) NOT NULL,
        occurred_at     timestamptz  NOT NULL,
        affected        integer      NOT NULL DEFAULT 0,
        houses_affected integer      NOT NULL DEFAULT 0,
        evacuated       integer      NOT NULL DEFAULT 0,
        deceased        integer      NOT NULL DEFAULT 0,
        raw             jsonb        NOT NULL,
        content_hash    char(64)     NOT NULL,
        last_seen_at    timestamptz  NOT NULL,
        created_at      timestamptz  NOT NULL DEFAULT now(),
        updated_at      timestamptz  NOT NULL,
        CONSTRAINT uq_hazard_events_source_external_id UNIQUE (source, external_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX ix_hazard_events_hazard_type ON hazard_events (hazard_type)`);
    await queryRunner.query(`CREATE INDEX ix_hazard_events_severity ON hazard_events (severity)`);
    await queryRunner.query(`CREATE INDEX ix_hazard_events_province ON hazard_events (province)`);
    await queryRunner.query(`CREATE INDEX ix_hazard_events_occurred_at ON hazard_events (occurred_at)`);
    await queryRunner.query(`CREATE INDEX ix_hazard_events_location ON hazard_events USING GIST (location)`);

    await queryRunner.query(`
      CREATE TABLE sync_runs (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source      varchar(32) NOT NULL,
        status      varchar(16) NOT NULL,
        trigger     varchar(16) NOT NULL,
        window_from timestamptz NOT NULL,
        window_to   timestamptz NOT NULL,
        started_at  timestamptz NOT NULL,
        finished_at timestamptz,
        fetched     integer NOT NULL DEFAULT 0,
        created     integer NOT NULL DEFAULT 0,
        updated     integer NOT NULL DEFAULT 0,
        unchanged   integer NOT NULL DEFAULT 0,
        error       text
      )
    `);
    await queryRunner.query(`CREATE INDEX ix_sync_runs_source_started_at ON sync_runs (source, started_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sync_runs`);
    await queryRunner.query(`DROP TABLE IF EXISTS hazard_events`);
  }
}
