import { DiscoveryService } from '@nestjs/core';
import type { HazardEventEntity } from '../events/entities/hazard-event.entity.js';

export type AlertReason = 'new' | 'escalated';

/** Alerta lista para enviar, independiente del canal (correo, SMS, Telegram, …). */
export interface HazardAlert {
  /**
   * Identifica el aviso: evento + motivo + severidad. El mismo evento puede
   * avisarse otra vez solo si escala (otro motivo o severidad).
   */
  key: string;
  reason: AlertReason;
  event: HazardEventEntity;
  subject: string;
  message: string;
}

/** A quién se envía. Hoy, por correo; otros canales agregarán sus datos (p. ej. teléfono). */
export interface NotificationRecipient {
  /** Suscriptor (null en un envío de prueba). */
  subscriberId: string | null;
  name: string;
  email: string;
  /** Provincias que eligió (vacío = todas); se mencionan en el pie del aviso. */
  provinces: string[];
}

export interface NotificationChannelAdapter {
  /** Nombre del canal para logs e historial, p. ej. "email". */
  readonly name: string;
  send(alert: HazardAlert, recipient: NotificationRecipient): Promise<void>;
}

/**
 * Marca un provider como canal de notificación. Cada alerta se envía por
 * todos los canales a cada suscriptor interesado; agregar un canal nuevo
 * (p. ej. SMS) no toca el resto.
 */
export const NotificationChannel = DiscoveryService.createDecorator<void>();
