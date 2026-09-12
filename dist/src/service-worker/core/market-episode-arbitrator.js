import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
function isCandidate(decision) {
    return decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT';
}
function score(decision) {
    return decision.modelScore ?? 0;
}
export class MarketEpisodeArbitrator {
    config;
    activeByAssetFeed = new Map();
    constructor(config) {
        this.config = config;
        if (!Number.isFinite(config.conflictScoreMargin) || config.conflictScoreMargin < 0 || config.conflictScoreMargin > 1) {
            throw new Error('conflictScoreMargin must be within [0, 1]');
        }
        if (!Number.isFinite(config.activeEpisodeHorizonMs) || config.activeEpisodeHorizonMs <= 0) {
            throw new Error('activeEpisodeHorizonMs must be positive');
        }
    }
    arbitrate(decisions, nowMs) {
        const candidates = decisions.filter(isCandidate);
        if (candidates.length === 0)
            return decisions;
        const canonicalAssetId = candidates[0]?.canonicalAssetId;
        const feedId = candidates[0]?.sourceFeedId;
        if (!canonicalAssetId || !feedId || candidates.some((decision) => decision.canonicalAssetId !== canonicalAssetId || decision.sourceFeedId !== feedId)) {
            return decisions.map((decision) => isCandidate(decision) ? this.suppress(decision, null, 'SUPPRESSED_CONFLICT', 'ARBITRATION_SOURCE_MISMATCH') : decision);
        }
        const key = this.key(canonicalAssetId, feedId);
        const active = this.activeByAssetFeed.get(key);
        if (active && nowMs <= active.expiresAt) {
            return decisions.map((decision) => isCandidate(decision)
                ? this.suppress(decision, active.marketEpisodeId, 'SUPPRESSED_ACTIVE_EPISODE', 'CORRELATED_ACTIVE_EPISODE')
                : decision);
        }
        if (active)
            this.activeByAssetFeed.delete(key);
        const ordered = [...candidates].sort((left, right) => score(right) - score(left) || left.timeframe.localeCompare(right.timeframe) || left.decisionId.localeCompare(right.decisionId));
        const top = ordered[0];
        if (!top)
            return decisions;
        const opposite = ordered.find((decision) => decision.finalDecision !== top.finalDecision);
        if (opposite && Math.abs(score(top) - score(opposite)) < this.config.conflictScoreMargin) {
            const conflictId = canonicalEntityHash('MARKET_EPISODE_CONFLICT', 1, {
                canonicalAssetId,
                feedId,
                createdAt: nowMs,
                decisionIds: ordered.map((decision) => decision.decisionId).sort(),
            });
            return decisions.map((decision) => isCandidate(decision)
                ? this.suppress(decision, conflictId, 'SUPPRESSED_CONFLICT', 'ARBITRATION_DIRECTION_CONFLICT')
                : decision);
        }
        const marketEpisodeId = canonicalEntityHash('MARKET_EPISODE', 1, {
            canonicalAssetId,
            feedId,
            primaryDecisionId: top.decisionId,
            direction: top.finalDecision,
            startedAt: nowMs,
            activeEpisodeHorizonMs: this.config.activeEpisodeHorizonMs,
        });
        this.activeByAssetFeed.set(key, {
            marketEpisodeId,
            canonicalAssetId,
            feedId,
            direction: top.finalDecision,
            primaryDecisionId: top.decisionId,
            expiresAt: nowMs + this.config.activeEpisodeHorizonMs,
        });
        return decisions.map((decision) => {
            if (!isCandidate(decision))
                return decision;
            if (decision.decisionId === top.decisionId) {
                return { ...decision, marketEpisodeId, arbitrationStatus: 'PRIMARY' };
            }
            const blocker = decision.finalDecision === top.finalDecision
                ? 'CORRELATED_TIMEFRAME_SUPPRESSED'
                : 'ARBITRATION_LOWER_SCORE_OPPOSITE_DIRECTION';
            return this.suppress(decision, marketEpisodeId, 'SUPPRESSED_CORRELATED', blocker);
        });
    }
    restoreActiveEpisode(input, nowMs) {
        if (input.expiresAt < nowMs)
            return;
        const key = this.key(input.canonicalAssetId, input.feedId);
        const existing = this.activeByAssetFeed.get(key);
        if (!existing || input.expiresAt > existing.expiresAt)
            this.activeByAssetFeed.set(key, input);
    }
    activeEpisodeCount(nowMs) {
        for (const [key, episode] of this.activeByAssetFeed)
            if (episode.expiresAt < nowMs)
                this.activeByAssetFeed.delete(key);
        return this.activeByAssetFeed.size;
    }
    suppress(decision, marketEpisodeId, arbitrationStatus, blocker) {
        return {
            ...decision,
            finalDecision: 'NO_TRADE',
            alertPublishedAt: null,
            marketEpisodeId,
            arbitrationStatus,
            blockers: [...decision.blockers, blocker],
        };
    }
    key(canonicalAssetId, feedId) {
        return `${canonicalAssetId}::${feedId}`;
    }
}
