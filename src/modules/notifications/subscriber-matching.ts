import { provinceKey } from '../../common/geo/ecuador-provinces.js';
import { SEVERITY_RANK } from '../events/domain/severity.js';
import type { NotificationSubscriberEntity } from './entities/notification-subscriber.entity.js';
import type { HazardAlert } from './notification-channel.js';

/**
 * ¿Este suscriptor debe recibir esta alerta? Sí si está activo, la severidad
 * es la que eligió o más grave, y el evento es de una de sus provincias (o no
 * eligió provincias = todo el país). Las provincias se comparan sin tildes ni
 * mayúsculas: la SNGR escribe "Los Rios" y el suscriptor "Los Ríos".
 */
export function subscriberWantsAlert(subscriber: NotificationSubscriberEntity, alert: HazardAlert): boolean {
  if (!subscriber.active) return false;
  if (SEVERITY_RANK[alert.event.severity] > SEVERITY_RANK[subscriber.minSeverity]) return false;
  if (subscriber.provinces.length === 0) return true;

  const eventProvince = alert.event.province;
  if (!eventProvince) return false;
  const key = provinceKey(eventProvince);
  return subscriber.provinces.some((province) => provinceKey(province) === key);
}
