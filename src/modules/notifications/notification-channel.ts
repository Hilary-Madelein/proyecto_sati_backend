import { DiscoveryService } from '@nestjs/core';
import type { HazardEventEntity } from '../events/entities/hazard-event.entity.js';

export type AlertReason = 'new' | 'escalated';

/** Alerta lista para enviar, independiente del canal (correo, SMS, Telegram, …). */
export interface HazardAlert {
  reason: AlertReason;
  event: HazardEventEntity;
  subject: string;
  message: string;
}

export interface NotificationChannelAdapter {
  /** Nombre del canal para logs, p. ej. "email". */
  readonly name: string;
  send(alert: HazardAlert): Promise<void>;
}

/**
 * Marca un provider como canal de notificación. Todos los canales marcados
 * reciben cada alerta; agregar uno nuevo (p. ej. correo) no toca el resto.
 */
export const NotificationChannel = DiscoveryService.createDecorator<void>();
