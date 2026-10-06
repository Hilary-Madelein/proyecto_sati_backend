import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service.js';
import { MailSender } from '../mail-sender.js';
import { NotificationChannel, type HazardAlert, type NotificationChannelAdapter, type NotificationRecipient } from '../notification-channel.js';
import { buildAlertEmail } from './alert-email.js';

/**
 * Canal de correo. Arma el mensaje y lo entrega con el MailSender configurado
 * (SMTP real, o solo el log si no hay SMTP: útil en desarrollo).
 */
@NotificationChannel()
@Injectable()
export class EmailNotificationChannel implements NotificationChannelAdapter {
  readonly name = 'email';

  constructor(
    private readonly mail: MailSender,
    private readonly config: AppConfigService,
  ) {}

  send(alert: HazardAlert, recipient: NotificationRecipient): Promise<void> {
    return this.mail.send(buildAlertEmail(alert, recipient, { appUrl: this.config.get('APP_PUBLIC_URL') }));
  }
}
