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
function performanceSlices(snapshot, mode, maxTimingErrorMs = null) {
    const decisionById = new Map(snapshot.decisions.map((decision) => [decision.decisionId, decision]));
    const signalById = new Map(snapshot.signals.map((signal) => [signal.signalId, signal]));
    const stats = new Map();
    for (const result of snapshot.results) {
        if (result.resolutionStatus !== 'RESOLVED' || result.directionalOutcome === 'FLAT')
            continue;
        if (maxTimingErrorMs !== null && result.expiryTimingErrorMs > maxTimingErrorMs)
            continue;
        const signal = signalById.get(result.signalId);
        if (!signal)
            continue;
        const decision = decisionById.get(signal.decisionId);
        if (!decision)
            continue;
        const keys = mode === 'TIMEFRAME'
            ? [decision.timeframe]
            : [...new Set(decision.strategySnapshots.filter((strategy) => strategy.direction === signal.direction).map((strategy) => strategy.strategyId))];
        for (const key of keys) {
            const current = stats.get(key) ?? { resolved: 0, correct: 0 };
            current.resolved += 1;
            if (result.directionalOutcome === 'CORRECT')
                current.correct += 1;
            stats.set(key, current);
        }
    }
    return [...stats.entries()]
        .map(([key, value]) => ({ key, ...value, accuracy: value.resolved === 0 ? null : value.correct / value.resolved }))
        .sort((a, b) => b.resolved - a.resolved || a.key.localeCompare(b.key));
}
export function computeAnalytics(snapshot, globalHealth, assetFeedHealth, captureTransport, activeEpisodeCount, strictSettlementMaxTimingErrorMs, relaxedSettlementMaxTimingErrorMs) {
    const callPutDecisions = snapshot.decisions.filter((decision) => decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT');
    const callPutDecisionCount = callPutDecisions.length;
    const rawCandidateDecisionCount = snapshot.decisions.filter((decision) => decision.arbitrationStatus !== 'NOT_APPLICABLE').length;
    const primaryEpisodeDecisionCount = snapshot.decisions.filter((decision) => decision.arbitrationStatus === 'PRIMARY').length;
    const suppressedCorrelatedDecisionCount = snapshot.decisions.filter((decision) => decision.arbitrationStatus === 'SUPPRESSED_CORRELATED' || decision.arbitrationStatus === 'SUPPRESSED_ACTIVE_EPISODE').length;
    const suppressedConflictDecisionCount = snapshot.decisions.filter((decision) => decision.arbitrationStatus === 'SUPPRESSED_CONFLICT').length;
    const marketEpisodeCount = new Set(snapshot.decisions.filter((decision) => decision.arbitrationStatus === 'PRIMARY' && decision.marketEpisodeId !== null).map((decision) => decision.marketEpisodeId)).size;
    const entryResolvedCount = snapshot.entryResolutions.filter((entry) => entry.resolutionStatus === 'RESOLVED').length;
    const entryUnresolvedCount = snapshot.entryResolutions.filter((entry) => entry.resolutionStatus === 'UNRESOLVED').length;
    const resolvedDecisionIds = new Set(snapshot.entryResolutions.map((entry) => entry.decisionId));
    const pendingEntryCount = callPutDecisions.filter((decision) => !resolvedDecisionIds.has(decision.decisionId)).length;
    const resultSignalIds = new Set(snapshot.results.map((result) => result.signalId));
    const pendingSignalCount = snapshot.signals.filter((signal) => !resultSignalIds.has(signal.signalId)).length;
    const resolved = snapshot.results.filter((result) => result.resolutionStatus === 'RESOLVED');
    const unresolvedResultCount = snapshot.results.length - resolved.length;
    const directional = resolved.filter((result) => result.directionalOutcome !== 'FLAT');
    const strictDirectional = directional.filter((result) => result.expiryTimingErrorMs <= strictSettlementMaxTimingErrorMs);
    const relaxedDirectional = directional.filter((result) => result.expiryTimingErrorMs <= relaxedSettlementMaxTimingErrorMs);
    const strictCorrect = strictDirectional.filter((result) => result.directionalOutcome === 'CORRECT').length;
    const relaxedCorrect = relaxedDirectional.filter((result) => result.directionalOutcome === 'CORRECT').length;
    const strictInterval = wilson(strictCorrect, strictDirectional.length);
    const relaxedInterval = wilson(relaxedCorrect, relaxedDirectional.length);
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
    const currentHealth = latestTick === null
        ? globalHealth
        : assetFeedHealth.find((item) => item.canonicalAssetId === latestTick.marketSourceIdentity.canonicalAssetId && item.feedId === latestTick.marketSourceIdentity.feedId) ?? globalHealth;
    return {
        tickCount: snapshot.ticks.length,
        candleCount: snapshot.candles.length,
        closedCandleCount: snapshot.candles.filter((candle) => candle.lifecycle === 'CLOSED').length,
        decisionCount: snapshot.decisions.length,
        rawCandidateDecisionCount,
        primaryEpisodeDecisionCount,
        suppressedCorrelatedDecisionCount,
        suppressedConflictDecisionCount,
        marketEpisodeCount,
        activeEpisodeCount,
        callPutDecisionCount,
        entryResolvedCount,
        entryUnresolvedCount,
        pendingEntryCount,
        entryResolutionRate: callPutDecisionCount === 0 ? null : entryResolvedCount / callPutDecisionCount,
        signalCount: snapshot.signals.length,
        pendingSignalCount,
        resolvedResultCount: resolved.length,
        unresolvedResultCount,
        resolvedDirectionalSampleSize: relaxedDirectional.length,
        independentEpisodeResolvedSampleSize: relaxedDirectional.length,
        directionalCorrectCount: relaxedCorrect,
        directionalAccuracy: relaxedDirectional.length === 0 ? null : relaxedCorrect / relaxedDirectional.length,
        directionalWilsonLow: relaxedInterval?.[0] ?? null,
        directionalWilsonHigh: relaxedInterval?.[1] ?? null,
        strictSettlementMaxTimingErrorMs,
        relaxedSettlementMaxTimingErrorMs,
        strictResolvedDirectionalSampleSize: strictDirectional.length,
        strictDirectionalCorrectCount: strictCorrect,
        strictDirectionalAccuracy: strictDirectional.length === 0 ? null : strictCorrect / strictDirectional.length,
        strictDirectionalWilsonLow: strictInterval?.[0] ?? null,
        strictDirectionalWilsonHigh: strictInterval?.[1] ?? null,
        relaxedResolvedDirectionalSampleSize: relaxedDirectional.length,
        relaxedDirectionalCorrectCount: relaxedCorrect,
        relaxedDirectionalAccuracy: relaxedDirectional.length === 0 ? null : relaxedCorrect / relaxedDirectional.length,
        relaxedDirectionalWilsonLow: relaxedInterval?.[0] ?? null,
        relaxedDirectionalWilsonHigh: relaxedInterval?.[1] ?? null,
        strategyPerformance: performanceSlices(snapshot, 'STRATEGY', relaxedSettlementMaxTimingErrorMs),
        timeframePerformance: performanceSlices(snapshot, 'TIMEFRAME', relaxedSettlementMaxTimingErrorMs),
        strictStrategyPerformance: performanceSlices(snapshot, 'STRATEGY', strictSettlementMaxTimingErrorMs),
        strictTimeframePerformance: performanceSlices(snapshot, 'TIMEFRAME', strictSettlementMaxTimingErrorMs),
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
        latestTickAgeMs: currentHealth.latestTickAgeMs,
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
        currentOperationalDataState: currentHealth.state,
        currentOperationalDataReason: currentHealth.reason,
        watchdogAssessedAt: currentHealth.assessedAt,
        healthDegradedAfterMs: currentHealth.thresholds.degradedAfterMs,
        healthStaleAfterMs: currentHealth.thresholds.staleAfterMs,
        healthDataUnavailableAfterMs: currentHealth.thresholds.dataUnavailableAfterMs,
        assetFeedHealth,
        healthyAssetFeedCount: assetFeedHealth.filter((item) => item.state === 'HEALTHY').length,
        degradedAssetFeedCount: assetFeedHealth.filter((item) => item.state === 'DEGRADED').length,
        staleAssetFeedCount: assetFeedHealth.filter((item) => item.state === 'STALE').length,
        unavailableAssetFeedCount: assetFeedHealth.filter((item) => item.state === 'DATA_UNAVAILABLE').length,
        latestModelScore: latestDecision?.modelScore ?? null,
        latestBlockers: latestDecision?.blockers ?? [],
        latestArbitrationStatus: latestDecision?.arbitrationStatus ?? null,
        captureTransport,
    };
}
