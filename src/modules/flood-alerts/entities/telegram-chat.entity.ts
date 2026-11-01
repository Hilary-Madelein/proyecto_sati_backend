import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { ChatScope, ScopeCanton } from '../flood-alert-scope.js';

/** Persona que abrió el enlace de invitación del bot. Se guarda solo lo necesario para escribirle. */
@Entity({ name: 'telegram_chats' })
export class TelegramChatEntity implements ChatScope {
  /** Id del chat en Telegram, como texto: puede superar los enteros de 32 bits. */
  @PrimaryColumn({ name: 'chat_id', type: 'varchar', length: 32 })
  chatId: string;

  @Column({ name: 'first_name', type: 'varchar', length: 120, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  /** false = pidió salir o bloqueó el bot: no se le envía nada. Conserva lo elegido por si vuelve. */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Provincias elegidas. Con `cantons`, vacío = todo el país. Queda guardado hasta que lo cambie con /alertas. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  provinces: string[];

  /** Cantones elegidos. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  cantons: ScopeCanton[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
