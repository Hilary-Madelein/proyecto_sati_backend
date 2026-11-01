import { LIKELIHOOD_RANK, type CantonForecast } from './flash-flood-cantons.js';

/** Emisiones seguidas que debe sostenerse una mejora antes de avisarla. */
const IMPROVEMENT_CONFIRMATIONS = 2;

/** Cantón con aviso vigente. */
export interface WatchedCanton extends CantonForecast {
  /** Emisiones seguidas en las que Google lo dejó por debajo de `likelihood`. */
  lowerRuns: number;
}

export interface IssueChanges {
  /** Entraron o subieron a Muy probable: se avisa enseguida. */
  worsened: CantonForecast[];
  /** Bajaron a Probable, confirmado. */
  lowered: CantonForecast[];
  /** Salieron del pronóstico, confirmado. */
  left: CantonForecast[];
  /** Estado tras esta emisión. */
  watched: WatchedCanton[];
}

const plain = ({ code, canton, province, likelihood }: WatchedCanton): CantonForecast => ({ code, canton, province, likelihood });

/**
 * Compara una emisión nueva con los avisos vigentes. Se compara por cantón porque
 * Google cambia todos los ids de zonas y eventos en cada emisión. Lo que empeora
 * se avisa de inmediato; lo que mejora, solo si la emisión siguiente lo confirma,
 * para no decir "ya pasó" por un cambio pasajero.
 */
export function applyIssue(previous: readonly WatchedCanton[], current: readonly CantonForecast[]): IssueChanges {
  const changes: IssueChanges = { worsened: [], lowered: [], left: [], watched: [] };
  const forecast = new Map(current.map((canton) => [canton.code, canton]));
  const known = new Set(previous.map((canton) => canton.code));

  for (const canton of current) {
    if (known.has(canton.code)) continue;
    changes.worsened.push(canton);
    changes.watched.push({ ...canton, lowerRuns: 0 });
  }

  for (const watched of previous) {
    const now = forecast.get(watched.code);
    const nowRank = now ? LIKELIHOOD_RANK[now.likelihood] : 0;
    const watchedRank = LIKELIHOOD_RANK[watched.likelihood];

    if (now && nowRank > watchedRank) {
      changes.worsened.push(now);
      changes.watched.push({ ...now, lowerRuns: 0 });
    } else if (nowRank === watchedRank) {
      changes.watched.push({ ...watched, lowerRuns: 0 });
    } else if (watched.lowerRuns + 1 < IMPROVEMENT_CONFIRMATIONS) {
      changes.watched.push({ ...watched, lowerRuns: watched.lowerRuns + 1 });
    } else if (now) {
      changes.lowered.push(now);
      changes.watched.push({ ...now, lowerRuns: 0 });
    } else {
      changes.left.push(plain(watched));
    }
  }
  return changes;
}

/** Terminó la vigencia sin una emisión nueva: los avisos que quedaban se cierran. */
export function applyExpiry(previous: readonly WatchedCanton[]): IssueChanges {
  return { worsened: [], lowered: [], left: previous.map(plain), watched: [] };
}
