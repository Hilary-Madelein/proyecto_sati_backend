export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Contrato para enviar un correo. Lo implementa la integración de correo
 * (hoy: Nodemailer por SMTP, o un emisor que solo escribe en el log cuando
 * no hay SMTP configurado).
 */
export abstract class MailSender {
  /** false = no hay servidor de correo configurado: los correos solo se registran en el log. */
  abstract readonly delivers: boolean;
  abstract send(message: MailMessage): Promise<void>;
}
