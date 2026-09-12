import type { OperationalDataState } from '../../common/models/types.js';

export interface DataHealthThresholds {
  degradedAfterMs: number;
  staleAfterMs: number;
  dataUnavailableAfterMs: number;
}

export type DataHealthReason =
  | 'NO_TICK_YET'
  | 'FRESH'
  | 'TICK_AGE_DEGRADED'
  | 'TICK_AGE_STALE'
  | 'TICK_AGE_DATA_UNAVAILABLE'
  | 'CONTINUITY_BROKEN';

export interface OperationalHealthSnapshot {
  state: OperationalDataState;
  reason: DataHealthReason;
  assessedAt: number;
  latestTickReceivedAt: number | null;
  latestTickAgeMs: number | null;
  thresholds: DataHealthThresholds;
}

export const DEFAULT_DATA_HEALTH_THRESHOLDS: DataHealthThresholds = {
  degradedAfterMs: 5_000,
  staleAfterMs: 15_000,
  dataUnavailableAfterMs: 60_000,
};

export function validateDataHealthThresholds(thresholds: DataHealthThresholds): void {
  if (!Number.isFinite(thresholds.degradedAfterMs) || thresholds.degradedAfterMs <= 0) throw new Error('degradedAfterMs must be positive');
  if (!Number.isFinite(thresholds.staleAfterMs) || thresholds.staleAfterMs <= thresholds.degradedAfterMs) throw new Error('staleAfterMs must be greater than degradedAfterMs');
  if (!Number.isFinite(thresholds.dataUnavailableAfterMs) || thresholds.dataUnavailableAfterMs <= thresholds.staleAfterMs) throw new Error('dataUnavailableAfterMs must be greater than staleAfterMs');
}

export function assessOperationalHealth(
  latestTickReceivedAt: number | null,
  startedAt: number,
  nowMs: number,
  thresholds: DataHealthThresholds,
): OperationalHealthSnapshot {
  validateDataHealthThresholds(thresholds);
  if (!Number.isFinite(startedAt) || !Number.isFinite(nowMs)) throw new Error('health clock must be finite');
  const safeNow = Math.max(nowMs, startedAt);
  if (latestTickReceivedAt === null) {
    const elapsed = safeNow - startedAt;
    return {
      state: elapsed > thresholds.dataUnavailableAfterMs ? 'DATA_UNAVAILABLE' : 'INITIALIZING',
      reason: 'NO_TICK_YET',
      assessedAt: safeNow,
      latestTickReceivedAt: null,
      latestTickAgeMs: null,
      thresholds,
    };
  }
  const age = Math.max(0, safeNow - latestTickReceivedAt);
  if (age <= thresholds.degradedAfterMs) {
    return { state: 'HEALTHY', reason: 'FRESH', assessedAt: safeNow, latestTickReceivedAt, latestTickAgeMs: age, thresholds };
  }
  if (age <= thresholds.staleAfterMs) {
    return { state: 'DEGRADED', reason: 'TICK_AGE_DEGRADED', assessedAt: safeNow, latestTickReceivedAt, latestTickAgeMs: age, thresholds };
  }
  if (age <= thresholds.dataUnavailableAfterMs) {
    return { state: 'STALE', reason: 'TICK_AGE_STALE', assessedAt: safeNow, latestTickReceivedAt, latestTickAgeMs: age, thresholds };
  }
  return { state: 'DATA_UNAVAILABLE', reason: 'TICK_AGE_DATA_UNAVAILABLE', assessedAt: safeNow, latestTickReceivedAt, latestTickAgeMs: age, thresholds };
}
