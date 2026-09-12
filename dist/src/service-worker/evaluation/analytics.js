import { PROTOCOL_VERIFICATION_REGISTRY_VERSION } from '../../common/protocol/protocol-verification-registry.js';
function wilson(successes, total, z = 1.96) {
    if (total === 0)
        return null;
    const p = successes / total;
    const z2 = z * z;
    const denominator = 1 + z2 / total;
    const center = (p + z2 / (2 * total)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
export function computeAnalytics(snapshot, health) {
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
    const latestTick = snapshot.ticks.reduce((latest, tick) => latest === null || tick.receivedAtEpochMs > latest.receivedAtEpochMs ? tick : latest, null);
    const latestDecision = snapshot.decisions.reduce((latest, decision) => latest === null || decision.decisionComputedAt > latest.decisionComputedAt ? decision : latest, null);
    const latestPayout = latestTick === null
        ? null
        : snapshot.payoutSnapshots
            .filter((payout) => payout.canonicalAssetId === latestTick.marketSourceIdentity.canonicalAssetId && payout.feedId === latestTick.marketSourceIdentity.feedId)
            .reduce((latest, payout) => latest === null || payout.capturedAt > latest.capturedAt ? payout : latest, null);
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
        latestTickAgeMs: health.latestTickAgeMs,
        latestSourceQuality: latestTick?.sourceQuality ?? null,
        latestProtocolVerificationId: latestTick?.protocolVerificationId ?? null,
        protocolRegistryVersion: PROTOCOL_VERIFICATION_REGISTRY_VERSION,
        latestTickIntegrity: latestTick?.integrity ?? null,
        latestPayoutRate: latestPayout?.payoutRate ?? null,
        latestPayoutExpirationSeconds: latestPayout?.expirationSeconds ?? null,
        latestPayoutExpirationBinding: latestPayout?.expirationBinding ?? null,
        latestPayoutQuality: latestPayout?.quality ?? null,
        latestPayoutProtocolVerificationId: latestPayout?.protocolVerificationId ?? null,
        latestPayoutCapturedAt: latestPayout?.capturedAt ?? null,
        latestDecision: latestDecision?.finalDecision ?? null,
        latestDecisionTimeframe: latestDecision?.timeframe ?? null,
        latestStructureRegime: latestDecision?.structureRegime ?? null,
        latestVolatilityRegime: latestDecision?.volatilityRegime ?? null,
        latestDecisionOperationalDataState: latestDecision?.operationalDataState ?? null,
        currentOperationalDataState: health.state,
        currentOperationalDataReason: health.reason,
        watchdogAssessedAt: health.assessedAt,
        healthDegradedAfterMs: health.thresholds.degradedAfterMs,
        healthStaleAfterMs: health.thresholds.staleAfterMs,
        healthDataUnavailableAfterMs: health.thresholds.dataUnavailableAfterMs,
        latestModelScore: latestDecision?.modelScore ?? null,
        latestBlockers: latestDecision?.blockers ?? [],
    };
}
