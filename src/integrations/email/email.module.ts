import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { MailSender } from '../../modules/notifications/mail-sender.js';
import { LogMailSender } from './log-mail-sender.js';
import { SmtpMailSender } from './smtp-mail-sender.js';

/** Envío de correo: SMTP real si hay SMTP_HOST; si no, solo el log (desarrollo). */
@Global()
@Module({
  providers: [
    {
      provide: MailSender,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => (config.get('SMTP_HOST') ? new SmtpMailSender(config) : new LogMailSender()),
    },
  ],
  exports: [MailSender],
})
export class EmailModule {}
