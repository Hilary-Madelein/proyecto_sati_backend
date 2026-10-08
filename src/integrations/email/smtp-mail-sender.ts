import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { MailSender, type MailMessage } from '../../modules/notifications/mail-sender.js';

const SERVICE = 'SMTP';

/**
 * Envía correos con Nodemailer por SMTP. Sirve con cualquier proveedor
 * (Gmail con contraseña de aplicación, Brevo, el correo institucional…): solo
 * cambian las variables SMTP_*. La contraseña nunca aparece en logs ni errores.
 */
@Injectable()
export class SmtpMailSender extends MailSender implements OnModuleDestroy {
  readonly delivers = true;
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: AppConfigService) {
    super();
    const user = config.get('SMTP_USER');
    this.from = config.get('MAIL_FROM')!;
    this.transporter = createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get('SMTP_PORT'),
      // true = TLS desde el inicio (puerto 465); false = STARTTLS (puerto 587).
      secure: config.get('SMTP_SECURE'),
      auth: user ? { user, pass: config.get('SMTP_PASS') } : undefined,
      // Una sola conexión reutilizada: varios avisos seguidos no abren una conexión cada uno.
      pool: true,
      maxConnections: 1,
      connectionTimeout: 20_000,
      socketTimeout: 30_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (error) {
      // El mensaje de Nodemailer describe el problema (p. ej. "Invalid login") sin incluir la contraseña.
      throw new UpstreamError(SERVICE, (error as Error).message, undefined, { cause: error });
    }
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
