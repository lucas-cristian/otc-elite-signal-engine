export interface TemporalObservation {
  timestampEpochMs: number;
  correct: boolean;
}

export interface UtcDatePerformance {
  utcDate: string;
  resolved: number;
  correct: number;
  accuracy: number;
}

export interface LeaveOneUtcDateOutPerformance {
  excludedUtcDate: string;
  resolved: number;
  correct: number;
  accuracy: number | null;
}

export interface TemporalRobustnessSummary {
  distinctUtcDateCount: number;
  maxEpisodesOnSingleUtcDate: number;
  utcDatePerformance: UtcDatePerformance[];
  leaveOneUtcDateOut: LeaveOneUtcDateOutPerformance[];
  minimumLeaveOneUtcDateOutAccuracy: number | null;
  worstExcludedUtcDate: string | null;
}

export function utcDateKey(timestampEpochMs: number): string {
  if (!Number.isFinite(timestampEpochMs)) throw new Error('Invalid UTC date timestamp');
  return new Date(timestampEpochMs).toISOString().slice(0, 10);
}

export function temporalRobustness(observations: TemporalObservation[]): TemporalRobustnessSummary {
  const stats = new Map<string, { resolved: number; correct: number }>();
  for (const observation of observations) {
    const utcDate = utcDateKey(observation.timestampEpochMs);
    const current = stats.get(utcDate) ?? { resolved: 0, correct: 0 };
    current.resolved += 1;
    if (observation.correct) current.correct += 1;
    stats.set(utcDate, current);
  }

  const utcDatePerformance = [...stats.entries()]
    .map(([utcDate, value]) => ({ utcDate, resolved: value.resolved, correct: value.correct, accuracy: value.correct / value.resolved }))
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const totalResolved = utcDatePerformance.reduce((sum, item) => sum + item.resolved, 0);
  const totalCorrect = utcDatePerformance.reduce((sum, item) => sum + item.correct, 0);
  const leaveOneUtcDateOut = utcDatePerformance.map((item) => {
    const resolved = totalResolved - item.resolved;
    const correct = totalCorrect - item.correct;
    return { excludedUtcDate: item.utcDate, resolved, correct, accuracy: resolved === 0 ? null : correct / resolved };
  });
  const finiteLeaveOne = leaveOneUtcDateOut.filter((item): item is LeaveOneUtcDateOutPerformance & { accuracy: number } => item.accuracy !== null);
  const worst = finiteLeaveOne.sort((a, b) => a.accuracy - b.accuracy || a.excludedUtcDate.localeCompare(b.excludedUtcDate))[0] ?? null;
  return {
    distinctUtcDateCount: utcDatePerformance.length,
    maxEpisodesOnSingleUtcDate: utcDatePerformance.reduce((maximum, item) => Math.max(maximum, item.resolved), 0),
    utcDatePerformance,
    leaveOneUtcDateOut,
    minimumLeaveOneUtcDateOutAccuracy: worst?.accuracy ?? null,
    worstExcludedUtcDate: worst?.excludedUtcDate ?? null,
  };
}
