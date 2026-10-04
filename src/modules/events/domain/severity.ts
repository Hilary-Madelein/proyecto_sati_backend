export const SEVERITIES = ['critical', 'high', 'moderate'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Crítico',
  high: 'Alto',
  moderate: 'Moderado',
};

/** Orden de mayor a menor gravedad (0 = más grave). */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, moderate: 2 };

export interface EventImpact {
  affected: number;
  housesAffected: number;
  evacuated: number;
  deceased: number;
}
