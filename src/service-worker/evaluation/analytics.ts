import type { JournalSnapshot } from '../storage/journal-repository.js';

export interface AnalyticsSnapshot {
  decisionCount: number;
  callPutDecisionCount: number;
  entryResolvedCount: number;
  entryUnresolvedCount: number;
  entryResolutionRate: number | null;
  resolvedDirectionalSampleSize: number;
  directionalCorrectCount: number;
  directionalAccuracy: number | null;
  directionalWilsonLow: number | null;
  directionalWilsonHigh: number | null;
  economicSampleSize: number;
  economicCoverageRate: number | null;
  observedMeanReferenceReturn: number | null;
  verifiedSettlementCount: number;
  inferredSettlementCount: number;
  unknownSettlementCount: number;
  economicEvidenceStatus: 'INSUFFICIENT_DATA' | 'DESCRIPTIVE_ONLY';
}

function wilson(successes: number, total: number, z = 1.96): [number, number] | null {
  if (total === 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function computeAnalytics(snapshot: JournalSnapshot): AnalyticsSnapshot {
  const callPutDecisionCount = snapshot.decisions.filter((decision) => decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT').length;
  const entryResolvedCount = snapshot.entryResolutions.filter((entry) => entry.resolutionStatus === 'RESOLVED').length;
  const entryUnresolvedCount = snapshot.entryResolutions.filter((entry) => entry.resolutionStatus === 'UNRESOLVED').length;
  const resolved = snapshot.results.filter((result) => result.resolutionStatus === 'RESOLVED');
  const directional = resolved.filter((result) => result.directionalOutcome !== 'FLAT');
  const correct = directional.filter((result) => result.directionalOutcome === 'CORRECT').length;
  const interval = wilson(correct, directional.length);
  const economic = resolved.flatMap((result) => result.economicReturn === null ? [] : [result.economicReturn]);
  const verifiedSettlementCount = resolved.filter((result) => result.settlementMetadata.confidence === 'VERIFIED').length;
  const inferredSettlementCount = resolved.filter((result) => result.settlementMetadata.confidence === 'INFERRED').length;
  const unknownSettlementCount = snapshot.results.length - verifiedSettlementCount - inferredSettlementCount;
  return {
    decisionCount: snapshot.decisions.length,
    callPutDecisionCount,
    entryResolvedCount,
    entryUnresolvedCount,
    entryResolutionRate: callPutDecisionCount === 0 ? null : entryResolvedCount / callPutDecisionCount,
    resolvedDirectionalSampleSize: directional.length,
    directionalCorrectCount: correct,
    directionalAccuracy: directional.length === 0 ? null : correct / directional.length,
    directionalWilsonLow: interval?.[0] ?? null,
    directionalWilsonHigh: interval?.[1] ?? null,
    economicSampleSize: economic.length,
    economicCoverageRate: resolved.length === 0 ? null : economic.length / resolved.length,
    observedMeanReferenceReturn: economic.length === 0 ? null : economic.reduce((sum, value) => sum + value, 0) / economic.length,
    verifiedSettlementCount,
    inferredSettlementCount,
    unknownSettlementCount,
    economicEvidenceStatus: economic.length === 0 ? 'INSUFFICIENT_DATA' : 'DESCRIPTIVE_ONLY',
  };
}
