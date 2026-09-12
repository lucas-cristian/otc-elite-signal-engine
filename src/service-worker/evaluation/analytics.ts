import type { JournalSnapshot } from '../storage/journal-repository.js';
import type { SourceQuality, StructureRegime, Timeframe, VolatilityRegime } from '../../common/models/types.js';
import type { FinalDecision } from '../../common/models/journal-types.js';

export interface AnalyticsSnapshot {
  tickCount: number;
  candleCount: number;
  closedCandleCount: number;
  decisionCount: number;
  callPutDecisionCount: number;
  entryResolvedCount: number;
  entryUnresolvedCount: number;
  pendingEntryCount: number;
  entryResolutionRate: number | null;
  signalCount: number;
  pendingSignalCount: number;
  resolvedResultCount: number;
  unresolvedResultCount: number;
  resolvedDirectionalSampleSize: number;
  directionalCorrectCount: number;
  directionalAccuracy: number | null;
  directionalWilsonLow: number | null;
  directionalWilsonHigh: number | null;
  economicSampleSize: number;
  economicIneligibleResolvedCount: number;
  economicCoverageRate: number | null;
  observedMeanReferenceReturn: number | null;
  verifiedSettlementCount: number;
  inferredSettlementCount: number;
  unknownSettlementCount: number;
  economicEvidenceStatus: 'INSUFFICIENT_DATA' | 'DESCRIPTIVE_ONLY';
  currentAssetId: string | null;
  currentInstrumentId: string | null;
  currentFeedId: string | null;
  latestPrice: number | null;
  latestTickReceivedAt: number | null;
  latestTickAgeMs: number | null;
  latestSourceQuality: SourceQuality | null;
  latestTickIntegrity: 'VALID' | 'SUSPECT' | 'INVALID' | null;
  latestPayoutRate: number | null;
  latestPayoutExpirationSeconds: number | null;
  latestPayoutQuality: SourceQuality | null;
  latestPayoutCapturedAt: number | null;
  latestDecision: FinalDecision | null;
  latestDecisionTimeframe: Timeframe | null;
  latestStructureRegime: StructureRegime | null;
  latestVolatilityRegime: VolatilityRegime | null;
  latestOperationalDataState: string | null;
  latestModelScore: number | null;
  latestBlockers: string[];
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

export function computeAnalytics(snapshot: JournalSnapshot, nowMs = Date.now()): AnalyticsSnapshot {
  const callPutDecisions = snapshot.decisions.filter((decision) => decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT');
  const callPutDecisionCount = callPutDecisions.length;
  const entryResolvedCount = snapshot.entryResolutions.filter((entry) => entry.resolutionStatus === 'RESOLVED').length;
  const entryUnresolvedCount = snapshot.entryResolutions.filter((entry) => entry.resolutionStatus === 'UNRESOLVED').length;
  const resolvedDecisionIds = new Set(snapshot.entryResolutions.map((entry) => entry.decisionId));
  const pendingEntryCount = callPutDecisions.filter((decision) => !resolvedDecisionIds.has(decision.decisionId)).length;

  const resultSignalIds = new Set(snapshot.results.map((result) => result.signalId));
  const pendingSignalCount = snapshot.signals.filter((signal) => !resultSignalIds.has(signal.signalId)).length;
  const resolved = snapshot.results.filter((result) => result.resolutionStatus === 'RESOLVED');
  const unresolvedResultCount = snapshot.results.length - resolved.length;
  const directional = resolved.filter((result) => result.directionalOutcome !== 'FLAT');
  const correct = directional.filter((result) => result.directionalOutcome === 'CORRECT').length;
  const interval = wilson(correct, directional.length);
  const economic = resolved.flatMap((result) => result.economicReturn === null ? [] : [result.economicReturn]);
  const verifiedSettlementCount = resolved.filter((result) => result.settlementMetadata.confidence === 'VERIFIED').length;
  const inferredSettlementCount = resolved.filter((result) => result.settlementMetadata.confidence === 'INFERRED').length;
  const unknownSettlementCount = snapshot.results.length - verifiedSettlementCount - inferredSettlementCount;

  const latestTick = snapshot.ticks.reduce((latest, tick) => latest === null || tick.receivedAtEpochMs > latest.receivedAtEpochMs ? tick : latest, snapshot.ticks[0] ?? null);
  const latestDecision = snapshot.decisions.reduce((latest, decision) => latest === null || decision.decisionComputedAt > latest.decisionComputedAt ? decision : latest, snapshot.decisions[0] ?? null);
  const latestPayout = latestTick === null
    ? null
    : snapshot.payoutSnapshots
      .filter((payout) => payout.canonicalAssetId === latestTick.marketSourceIdentity.canonicalAssetId && payout.feedId === latestTick.marketSourceIdentity.feedId)
      .reduce((latest, payout) => latest === null || payout.capturedAt > latest.capturedAt ? payout : latest, null as typeof snapshot.payoutSnapshots[number] | null);

  return {
    tickCount: snapshot.ticks.length,
    candleCount: snapshot.candles.length,
    closedCandleCount: snapshot.candles.filter((candle) => candle.lifecycle === 'CLOSED').length,
    decisionCount: snapshot.decisions.length,
    callPutDecisionCount,
    entryResolvedCount,
    entryUnresolvedCount,
    pendingEntryCount,
    entryResolutionRate: callPutDecisionCount === 0 ? null : entryResolvedCount / callPutDecisionCount,
    signalCount: snapshot.signals.length,
    pendingSignalCount,
    resolvedResultCount: resolved.length,
    unresolvedResultCount,
    resolvedDirectionalSampleSize: directional.length,
    directionalCorrectCount: correct,
    directionalAccuracy: directional.length === 0 ? null : correct / directional.length,
    directionalWilsonLow: interval?.[0] ?? null,
    directionalWilsonHigh: interval?.[1] ?? null,
    economicSampleSize: economic.length,
    economicIneligibleResolvedCount: resolved.length - economic.length,
    economicCoverageRate: resolved.length === 0 ? null : economic.length / resolved.length,
    observedMeanReferenceReturn: economic.length === 0 ? null : economic.reduce((sum, value) => sum + value, 0) / economic.length,
    verifiedSettlementCount,
    inferredSettlementCount,
    unknownSettlementCount,
    economicEvidenceStatus: economic.length === 0 ? 'INSUFFICIENT_DATA' : 'DESCRIPTIVE_ONLY',
    currentAssetId: latestTick?.marketSourceIdentity.canonicalAssetId ?? null,
    currentInstrumentId: latestTick?.marketSourceIdentity.instrumentId ?? null,
    currentFeedId: latestTick?.marketSourceIdentity.feedId ?? null,
    latestPrice: latestTick?.price ?? null,
    latestTickReceivedAt: latestTick?.receivedAtEpochMs ?? null,
    latestTickAgeMs: latestTick === null ? null : Math.max(0, nowMs - latestTick.receivedAtEpochMs),
    latestSourceQuality: latestTick?.sourceQuality ?? null,
    latestTickIntegrity: latestTick?.integrity ?? null,
    latestPayoutRate: latestPayout?.payoutRate ?? null,
    latestPayoutExpirationSeconds: latestPayout?.expirationSeconds ?? null,
    latestPayoutQuality: latestPayout?.quality ?? null,
    latestPayoutCapturedAt: latestPayout?.capturedAt ?? null,
    latestDecision: latestDecision?.finalDecision ?? null,
    latestDecisionTimeframe: latestDecision?.timeframe ?? null,
    latestStructureRegime: latestDecision?.structureRegime ?? null,
    latestVolatilityRegime: latestDecision?.volatilityRegime ?? null,
    latestOperationalDataState: latestDecision?.operationalDataState ?? null,
    latestModelScore: latestDecision?.modelScore ?? null,
    latestBlockers: latestDecision?.blockers ?? [],
  };
}
