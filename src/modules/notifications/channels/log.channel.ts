import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, type HazardAlert, type NotificationChannelAdapter } from '../notification-channel.js';

/**
 * Canal que solo escribe la alerta en el log. Sirve para desarrollo y para
 * verificar la regla de alertas antes de conectar el correo.
 */
@NotificationChannel()
@Injectable()
export class LogNotificationChannel implements NotificationChannelAdapter {
  readonly name = 'log';
  private readonly logger = new Logger('Alertas');

  async send(alert: HazardAlert): Promise<void> {
    this.logger.warn(`${alert.subject}\n${alert.message}`);
  }
}
