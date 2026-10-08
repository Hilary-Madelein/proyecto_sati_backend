import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cuenta de una persona que administra SATI.EC. Entra con su correo y su
 * contraseña; de la contraseña solo se guarda el hash (ver password-hasher.ts).
 */
@Entity({ name: 'admin_users' })
export class AdminUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** En minúsculas; único. */
  @Column({ type: 'varchar', length: 254, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  /** Desactivada = no puede entrar, pero la cuenta se conserva. */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Contraseña temporal (la puso otro administrador): debe cambiarla al entrar. */
  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Lo que la API muestra de una cuenta: nunca el hash de la contraseña. */
export interface AdminUserView {
  id: string;
  name: string;
  email: string;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toAdminUserView(user: AdminUserEntity): AdminUserView {
  const { id, name, email, active, mustChangePassword, lastLoginAt, createdAt } = user;
  return { id, name, email, active, mustChangePassword, lastLoginAt, createdAt };
}
