import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Cuentas de administración (correo + contraseña) y sus sesiones. */
export class AdminAccounts1791331200000 implements MigrationInterface {
  name = 'AdminAccounts1791331200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admin_users (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name                 varchar(120) NOT NULL,
        email                varchar(254) NOT NULL,
        password_hash        varchar(255) NOT NULL,
        active               boolean      NOT NULL DEFAULT true,
        must_change_password boolean      NOT NULL DEFAULT false,
        last_login_at        timestamptz,
        created_at           timestamptz  NOT NULL DEFAULT now(),
        updated_at           timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT uq_admin_users_email UNIQUE (email)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE admin_sessions (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid        NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
        token_hash char(64)    NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_admin_sessions_token_hash UNIQUE (token_hash)
      )
    `);
    await queryRunner.query(`CREATE INDEX ix_admin_sessions_user ON admin_sessions (user_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE admin_sessions`);
    await queryRunner.query(`DROP TABLE admin_users`);
  }
}
