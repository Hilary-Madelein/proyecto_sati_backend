import { Injectable, Logger } from '@nestjs/common';
import { MailSender, type MailMessage } from '../../modules/notifications/mail-sender.js';

/**
 * Emisor para desarrollo: sin SMTP configurado, escribe el correo en el log
 * en vez de enviarlo. Así se puede probar todo el flujo sin un servidor de correo.
 */
@Injectable()
export class LogMailSender extends MailSender {
  readonly delivers = false;
  private readonly logger = new Logger('Correo (simulado)');

  async send(message: MailMessage): Promise<void> {
    this.logger.warn(`Para: ${message.to}\nAsunto: ${message.subject}\n${message.text}`);
  }
}
