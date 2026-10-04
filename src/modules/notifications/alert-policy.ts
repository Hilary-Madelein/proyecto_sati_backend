import { HAZARD_TYPES } from '../events/domain/hazard-type.js';
import type { HazardEventCreated, HazardEventUpdated } from '../events/domain/hazard-event.events.js';
import { SEVERITY_LABELS, SEVERITY_RANK, type Severity } from '../events/domain/severity.js';
import type { HazardEventEntity } from '../events/entities/hazard-event.entity.js';
import type { HazardAlert } from './notification-channel.js';

const ALERTABLE: ReadonlySet<Severity> = new Set(['critical', 'high']);
/**
 * Solo se alerta por eventos recientes: así la carga inicial (que trae semanas
 * de historia como "nuevos") no dispara cientos de avisos.
 */
const MAX_EVENT_AGE_MS = 48 * 60 * 60 * 1000;

const isRecent = (event: HazardEventEntity, now: Date) => now.getTime() - event.occurredAt.getTime() <= MAX_EVENT_AGE_MS;

/** Evento nuevo, abierto, reciente y grave → alerta. */
export function alertForCreated({ event }: HazardEventCreated, now = new Date()): HazardAlert | null {
  if (event.status !== 'open' || !ALERTABLE.has(event.severity) || !isRecent(event, now)) return null;
  return buildAlert('new', event);
}

/** Evento abierto que sube de severidad hasta un nivel grave → alerta. */
export function alertForUpdated({ event, previous }: HazardEventUpdated, now = new Date()): HazardAlert | null {
  const escalated = SEVERITY_RANK[event.severity] < SEVERITY_RANK[previous.severity];
  if (event.status !== 'open' || !escalated || !ALERTABLE.has(event.severity) || !isRecent(event, now)) return null;
  return buildAlert('escalated', event);
}

function buildAlert(reason: HazardAlert['reason'], event: HazardEventEntity): HazardAlert {
  const severity = SEVERITY_LABELS[event.severity];
  const place = [event.canton, event.province].filter(Boolean).join(', ') || 'ubicación sin especificar';
  const prefix = reason === 'new' ? 'Nuevo evento' : 'Evento escalado a';

  const subject = `[${severity}] ${HAZARD_TYPES[event.hazardType]} — ${place}`;
  const impact = [
    `${event.affected} personas afectadas`,
    `${event.housesAffected} viviendas afectadas`,
    `${event.evacuated} evacuados`,
    `${event.deceased} fallecidos`,
  ].join(' · ');
  const message = [`${prefix} ${severity.toLowerCase()}: ${event.title}.`, `Lugar: ${place}.`, `Impacto: ${impact}.`, event.description]
    .filter(Boolean)
    .join('\n');

  return { reason, event, subject, message };
}
