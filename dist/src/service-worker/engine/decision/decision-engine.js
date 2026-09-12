import { canonicalEntityHash } from '../../../common/hashing/canonical-hash.js';
import { EvidenceAggregator } from './evidence-aggregator.js';
import { StrategySelector } from './strategies.js';
export class DecisionEngine {
    config;
    selector = new StrategySelector();
    aggregator = new EvidenceAggregator();
    constructor(config) {
        this.config = config;
    }
    evaluate(input) {
        const evaluationWindow = this.evaluationWindow(input);
        const blockers = [];
        if (input.features === null)
            blockers.push('CORE_WARMUP');
        if (input.eventIntegrity !== 'VALID')
            blockers.push('EVENT_INTEGRITY');
        if (input.sourceQuality !== 'VERIFIED' || input.sourceProtocolVerificationId === null)
            blockers.push('UNVERIFIED_SOURCE_SCHEMA');
        if (input.operationalDataState !== 'HEALTHY')
            blockers.push(`DATA_STATE_${input.operationalDataState}`);
        if (input.regime.structure === 'CHAOTIC')
            blockers.push('CHAOTIC_REGIME');
        if (input.regime.structure === 'UNKNOWN' || input.regime.volatility === 'UNKNOWN')
            blockers.push('UNKNOWN_REGIME');
        const strategySnapshots = input.features ? this.selector.evaluate(input.features, input.regime) : [];
        const evidenceSnapshot = input.features ? this.aggregator.aggregate(strategySnapshots) : null;
        const candidateDirection = evidenceSnapshot?.dominantDirection ?? null;
        if (!candidateDirection)
            blockers.push('NO_DOMINANT_DIRECTION');
        if ((evidenceSnapshot?.modelScore ?? 0) < this.config.minModelScore)
            blockers.push('BELOW_MODEL_SCORE_THRESHOLD');
        const finalDecision = blockers.length > 0
            ? input.operationalDataState === 'DATA_UNAVAILABLE' || input.operationalDataState === 'STALE' ? 'DATA_UNAVAILABLE' : 'NO_TRADE'
            : candidateDirection ?? 'NO_TRADE';
        const granularityPayload = {
            evaluationWindowId: evaluationWindow.evaluationWindowId,
            strategyGroupId: 'CORE_STRATEGIES_V1',
            expirationSeconds: this.config.expirationSeconds,
            configHash: this.config.configHash,
        };
        const decisionGranularityKey = canonicalEntityHash('DECISION_GRANULARITY', 1, granularityPayload);
        const decisionId = canonicalEntityHash('DECISION', 2, {
            decisionGranularityKey,
            finalDecision,
            candidateDirection,
            modelScore: evidenceSnapshot?.modelScore ?? null,
            informationCutoffTimestamp: input.features?.informationCutoffTimestamp ?? input.candleEndTimestamp,
        });
        const publishedAt = input.computedAt;
        return {
            decisionSchemaVersion: '4',
            decisionId,
            decisionGranularityKey,
            executionMode: this.config.executionMode,
            canonicalAssetId: input.canonicalAssetId,
            timeframe: input.timeframe,
            decisionComputedAt: input.computedAt,
            decisionPublishedAt: publishedAt,
            alertPublishedAt: finalDecision === 'CALL' || finalDecision === 'PUT' ? publishedAt : null,
            evaluationWindowId: evaluationWindow.evaluationWindowId,
            candleStartTimestamp: input.candleStartTimestamp,
            candidateDirection,
            finalDecision,
            modelScore: evidenceSnapshot?.modelScore ?? null,
            calibratedProbability: null,
            structureRegime: input.regime.structure,
            volatilityRegime: input.regime.volatility,
            strategySnapshots,
            featureSnapshot: input.features,
            evidenceSnapshot,
            sourceQuality: input.sourceQuality,
            sourceFeedId: input.sourceFeedId,
            sourceProtocolVerificationId: input.sourceProtocolVerificationId,
            eventIntegrity: input.eventIntegrity,
            operationalDataState: input.operationalDataState,
            blockers,
            expirationSeconds: this.config.expirationSeconds,
            configHash: this.config.configHash,
            configSnapshot: this.config.configSnapshot,
            appVersion: this.config.appVersion,
            marketEpisodeId: null,
            arbitrationStatus: 'NOT_APPLICABLE',
            createdAt: input.computedAt,
        };
    }
    evaluationWindow(input) {
        const payload = {
            canonicalAssetId: input.canonicalAssetId,
            timeframe: input.timeframe,
            candleStartTimestamp: input.candleStartTimestamp,
            windowStartTimestamp: input.candleStartTimestamp,
            windowEndTimestamp: input.candleEndTimestamp,
            expirationSeconds: this.config.expirationSeconds,
            configHash: this.config.configHash,
        };
        return { evaluationWindowId: canonicalEntityHash('EVALUATION_WINDOW', 1, payload), ...payload };
    }
}
