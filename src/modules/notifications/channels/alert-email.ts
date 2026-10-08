import { escapeHtml } from '../../../common/text/escape-html.js';
import { SEVERITY_LABELS, type Severity } from '../../events/domain/severity.js';
import type { MailMessage } from '../mail-sender.js';
import type { HazardAlert, NotificationRecipient } from '../notification-channel.js';

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  moderate: '#ca8a04',
};

const dateFormat = new Intl.DateTimeFormat('es-EC', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Guayaquil',
});

export interface AlertEmailOptions {
  /** Dirección pública del mapa (APP_PUBLIC_URL), para el enlace "Ver en el mapa". */
  appUrl?: string;
}

/** Arma el correo de una alerta para un destinatario: asunto, texto plano y HTML. */
export function buildAlertEmail(alert: HazardAlert, recipient: NotificationRecipient, options: AlertEmailOptions = {}): MailMessage {
  const { event } = alert;
  const occurredAt = dateFormat.format(event.occurredAt);
  const scope = recipient.provinces.length > 0 ? recipient.provinces.join(', ') : 'todo el país';
  const footer = `Recibes este aviso porque estás suscrito a las alertas de SATI.EC para ${scope}. Para dejar de recibirlos, contacta al administrador del sistema.`;
  const greeting = `Hola, ${recipient.name}:`;

  const text = [
    greeting,
    '',
    alert.message,
    '',
    `Ocurrió: ${occurredAt} (hora de Ecuador).`,
    'Fuente: Secretaría Nacional de Gestión de Riesgos (SNGR).',
    options.appUrl ? `Ver en el mapa: ${options.appUrl}` : null,
    '',
    footer,
  ]
    .filter((line) => line !== null)
    .join('\n');

  // Los textos vienen de la SNGR: todo lo dinámico pasa por escapeHtml.
  const color = SEVERITY_COLORS[event.severity];
  const paragraphs = alert.message
    .split('\n')
    .map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`)
    .join('');
  const button = options.appUrl
    ? `<p style="margin:16px 0"><a href="${escapeHtml(options.appUrl)}" style="background:#1d4ed8;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600">Ver en el mapa</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="height:6px;background:${color}"></div>
      <div style="padding:20px 24px">
        <p style="margin:0 0 4px;font-size:12px;color:#64748b">SATI.EC · Alerta de ${escapeHtml(SEVERITY_LABELS[event.severity].toLowerCase())} severidad</p>
        <h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(alert.subject)}</h1>
        <p style="margin:0 0 12px">${escapeHtml(greeting)}</p>
        ${paragraphs}
        <p style="margin:12px 0 0;font-size:13px;color:#475569">Ocurrió: ${escapeHtml(occurredAt)} (hora de Ecuador) · Fuente: SNGR</p>
        ${button}
      </div>
      <p style="margin:0;padding:12px 24px;background:#f8fafc;font-size:12px;color:#64748b">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`;

  return { to: recipient.email, subject: alert.subject, text, html };
}
