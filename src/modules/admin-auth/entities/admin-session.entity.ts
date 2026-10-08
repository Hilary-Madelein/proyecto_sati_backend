import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Sesión abierta de un administrador. El token se entrega una sola vez al
 * iniciar sesión; aquí solo se guarda su SHA-256, así que una copia de la
 * base de datos no permite entrar. Borrar la fila cierra la sesión.
 */
@Entity({ name: 'admin_sessions' })
@Index('ix_admin_sessions_user', ['userId'])
export class AdminSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** SHA-256 del token, en hexadecimal. */
  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
