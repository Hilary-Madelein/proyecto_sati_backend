import type { RiverAlertsSnapshot } from './river.js';

/** Pronósticos diarios hacia atrás con que se mide la persistencia. */
export const PERSISTENCE_WINDOW_DAYS = 30;
/**
 * Un tramo que amanece con alerta en el 60 % o más de los pronósticos es
 * "persistente". Al cruzar las alertas con los desbordes de la SNGR
 * (agosto-octubre de 2026), esos tramos (el estuario en Guayaquil y ríos que
 * cruzan ciudades andinas) no coincidieron con ningún desborde: lo más probable
 * es que el modelo los sobrestime.
 */
export const PERSISTENT_SHARE = 0.6;
/** Con menos pronósticos que estos la proporción no es confiable y no se marca nada. */
export const MIN_FORECASTS = 10;

export interface AlertPersistence {
  /** Pronósticos usados (los días sin publicar no cuentan). */
  forecasts: number;
  /** Parte de esos pronósticos en que cada tramo tenía alerta el primer día. */
  shareByRiver: ReadonlyMap<number, number>;
}

/** Cuántas veces amaneció con alerta cada tramo en los pronósticos dados. */
export function alertPersistence(snapshots: readonly RiverAlertsSnapshot[]): AlertPersistence {
  const counts = new Map<number, number>();
  for (const snapshot of snapshots) {
    for (const alert of snapshot.alerts) {
      if ((alert.dailyLevels[0] ?? 0) > 0) counts.set(alert.riverId, (counts.get(alert.riverId) ?? 0) + 1);
    }
  }
  const forecasts = snapshots.length;
  return { forecasts, shareByRiver: new Map([...counts].map(([riverId, count]) => [riverId, count / forecasts])) };
}

/** Agrega a cada alerta su persistencia; sin datos suficientes, las deja sin marcar. */
export function withPersistence(snapshot: RiverAlertsSnapshot, persistence: AlertPersistence | null): RiverAlertsSnapshot {
  const usable = persistence && persistence.forecasts >= MIN_FORECASTS ? persistence : null;
  return {
    ...snapshot,
    persistence: usable && { forecasts: usable.forecasts, threshold: PERSISTENT_SHARE },
    alerts: snapshot.alerts.map((alert) => {
      const share = usable ? (usable.shareByRiver.get(alert.riverId) ?? 0) : null;
      return { ...alert, alertShare: share, persistent: share !== null && share >= PERSISTENT_SHARE };
    }),
  };
}
