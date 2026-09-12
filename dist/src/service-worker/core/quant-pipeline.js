import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
import { PROTOCOL_VERIFICATION_REGISTRY_VERSION } from '../../common/protocol/protocol-verification-registry.js';
import { CandleBuilder } from '../engine/candle-builder.js';
import { FeatureEngine } from '../engine/feature-engine.js';
import { RegimeDetector } from '../engine/regime-detector.js';
import { DecisionEngine } from '../engine/decision/decision-engine.js';
import { EntryResolver } from '../engine/decision/entry-resolver.js';
import { ResultEngine } from '../evaluation/result-engine.js';
import { RecoveryService } from '../storage/recovery-service.js';
import { assessOperationalHealth, DEFAULT_DATA_HEALTH_THRESHOLDS, validateDataHealthThresholds, } from './data-health.js';
import { MarketEpisodeArbitrator } from './market-episode-arbitrator.js';
export const DEFAULT_PIPELINE_CONFIG = {
    appVersion: '1.5.0',
    executionMode: 'LIVE',
    timeframes: ['5s', '10s', '15s', '30s', '60s'],
    expirationSeconds: 60,
    minModelScore: 0.35,
    maxEntryResolutionDelayMs: 3_000,
    maxExpiryResolutionDelayMs: 5_000,
    maxHotTicks: 2_000,
    maxCandlesPerTimeframe: 200,
    dataHealthThresholds: DEFAULT_DATA_HEALTH_THRESHOLDS,
    arbitrationConflictScoreMargin: 0.10,
    episodeHorizonMs: 68_000,
};
export class QuantPipeline {
    journal;
    config;
    assets = new Map();
    featureEngine = new FeatureEngine();
    regimeDetector = new RegimeDetector();
    entryResolver;
    resultEngine;
    decisionEngine;
    episodeArbitrator;
    pendingEntries = new Map();
    pendingSignals = new Map();
    payoutByAssetAndFeed = new Map();
    emittedCandles = [];
    processing = Promise.resolve();
    currentNow = 0;
    startedAt = 0;
    latestTick = null;
    constructor(journal, config) {
        this.journal = journal;
        this.config = config;
        validateDataHealthThresholds(config.dataHealthThresholds);
        this.entryResolver = new EntryResolver(config.maxEntryResolutionDelayMs);
        this.resultEngine = new ResultEngine(config.maxExpiryResolutionDelayMs);
        this.episodeArbitrator = new MarketEpisodeArbitrator({
            conflictScoreMargin: config.arbitrationConflictScoreMargin,
            activeEpisodeHorizonMs: config.episodeHorizonMs,
        });
        const configSnapshot = {
            timeframes: config.timeframes,
            expirationSeconds: config.expirationSeconds,
            minModelScore: config.minModelScore,
            maxEntryResolutionDelayMs: config.maxEntryResolutionDelayMs,
            maxExpiryResolutionDelayMs: config.maxExpiryResolutionDelayMs,
            dataHealthThresholds: config.dataHealthThresholds,
            arbitrationConflictScoreMargin: config.arbitrationConflictScoreMargin,
            episodeHorizonMs: config.episodeHorizonMs,
            protocolRegistryVersion: PROTOCOL_VERIFICATION_REGISTRY_VERSION,
        };
        this.decisionEngine = new DecisionEngine({
            executionMode: config.executionMode,
            appVersion: config.appVersion,
            configHash: canonicalEntityHash('CONFIG', 3, configSnapshot),
            configSnapshot,
            expirationSeconds: config.expirationSeconds,
            minModelScore: config.minModelScore,
        });
    }
    async initialize(nowMs) {
        this.startedAt = nowMs;
        this.currentNow = nowMs;
        const recovery = await new RecoveryService(this.journal).derive();
        this.latestTick = recovery.latestTick;
        for (const tick of recovery.latestTicksByAssetFeed)
            this.restoreLatestTick(tick);
        for (const payout of recovery.latestPayoutSnapshots) {
            this.payoutByAssetAndFeed.set(this.payoutKey(payout.canonicalAssetId, payout.feedId), payout);
        }
        for (const decision of recovery.pendingEntries) {
            const health = this.healthForDecision(decision, nowMs);
            const timeout = this.entryResolver.timeout(decision, nowMs, this.entryTimeoutReason(health.state));
            if (timeout)
                await this.journal.appendEntryResolution(timeout);
            else {
                this.pendingEntries.set(decision.decisionId, decision);
                this.restoreDecisionEpisode(decision, nowMs);
            }
        }
        for (const signal of recovery.pendingResults) {
            const health = this.healthForSignal(signal, nowMs);
            const timeout = this.resultEngine.timeout(signal, nowMs, this.resultTimeoutReason(health.state));
            if (timeout)
                await this.journal.appendResult(timeout);
            else {
                this.pendingSignals.set(signal.signalId, signal);
                this.restoreSignalEpisode(signal, nowMs);
            }
        }
    }
    enqueue(observation) {
        this.processing = this.processing.then(() => this.processObservation(observation));
        return this.processing;
    }
    enqueuePayout(payoutSnapshot) {
        this.processing = this.processing.then(() => this.processPayout(payoutSnapshot));
        return this.processing;
    }
    watchdog(nowMs) {
        this.processing = this.processing.then(() => this.processWatchdog(nowMs));
        return this.processing;
    }
    getOperationalHealth(nowMs) {
        return assessOperationalHealth(this.latestTick?.receivedAtEpochMs ?? null, this.startedAt, nowMs, this.config.dataHealthThresholds);
    }
    getAssetFeedOperationalHealth(canonicalAssetId, feedId, nowMs) {
        const runtime = this.assets.get(this.assetKey(canonicalAssetId, feedId));
        const health = assessOperationalHealth(runtime?.latestTick?.receivedAtEpochMs ?? null, runtime?.startedAt ?? this.startedAt, nowMs, this.config.dataHealthThresholds);
        return { canonicalAssetId, feedId, ...health };
    }
    getAllAssetFeedOperationalHealth(nowMs) {
        return [...this.assets.values()]
            .map((runtime) => this.getAssetFeedOperationalHealth(runtime.canonicalAssetId, runtime.feedId, nowMs))
            .sort((a, b) => a.canonicalAssetId.localeCompare(b.canonicalAssetId) || a.feedId.localeCompare(b.feedId));
    }
    getActiveEpisodeCount(nowMs) {
        return this.episodeArbitrator.activeEpisodeCount(nowMs);
    }
    async drain() {
        await this.processing;
    }
    async finalizeThrough(nowMs) {
        await this.watchdog(nowMs);
    }
    async processObservation(observation) {
        const tick = observation.tick;
        this.currentNow = Math.max(this.currentNow, tick.receivedAtEpochMs);
        await this.expirePending(tick.receivedAtEpochMs);
        this.latestTick = this.latestTick === null || tick.receivedAtEpochMs >= this.latestTick.receivedAtEpochMs ? tick : this.latestTick;
        const asset = this.assetRuntime(tick.marketSourceIdentity.canonicalAssetId, tick.marketSourceIdentity.feedId, tick.receivedAtEpochMs);
        asset.latestTick = tick;
        await this.journal.appendTick(tick);
        await this.resolveExistingEntries(tick);
        await this.resolveExistingResults(tick);
        asset.ticks.push(tick);
        if (asset.ticks.length > this.config.maxHotTicks)
            asset.ticks.splice(0, asset.ticks.length - this.config.maxHotTicks);
        for (const builder of asset.builders.values())
            builder.ingest(tick);
        await this.drainCandles(asset, tick.receivedAtEpochMs);
    }
    async processPayout(payoutSnapshot) {
        this.currentNow = Math.max(this.currentNow, payoutSnapshot.capturedAt);
        this.payoutByAssetAndFeed.set(this.payoutKey(payoutSnapshot.canonicalAssetId, payoutSnapshot.feedId), payoutSnapshot);
        await this.journal.appendPayoutSnapshot(payoutSnapshot);
    }
    async processWatchdog(nowMs) {
        this.currentNow = Math.max(this.currentNow, nowMs);
        for (const asset of this.assets.values()) {
            for (const builder of asset.builders.values())
                builder.advanceClock(nowMs);
            await this.drainCandles(asset, nowMs);
        }
        await this.expirePending(nowMs);
    }
    assetRuntime(canonicalAssetId, feedId, startedAt = this.currentNow) {
        const key = this.assetKey(canonicalAssetId, feedId);
        const existing = this.assets.get(key);
        if (existing)
            return existing;
        const candles = new Map();
        const builders = new Map();
        for (const timeframe of this.config.timeframes) {
            candles.set(timeframe, []);
            builders.set(timeframe, new CandleBuilder(canonicalAssetId, feedId, timeframe, (candle) => this.emittedCandles.push(candle)));
        }
        const created = { canonicalAssetId, feedId, builders, candles, ticks: [], latestTick: null, startedAt };
        this.assets.set(key, created);
        return created;
    }
    restoreLatestTick(tick) {
        const runtime = this.assetRuntime(tick.marketSourceIdentity.canonicalAssetId, tick.marketSourceIdentity.feedId, tick.receivedAtEpochMs);
        if (runtime.latestTick === null || tick.receivedAtEpochMs > runtime.latestTick.receivedAtEpochMs)
            runtime.latestTick = tick;
    }
    async drainCandles(asset, nowMs) {
        const decisions = [];
        const remaining = [];
        while (this.emittedCandles.length > 0) {
            const candle = this.emittedCandles.shift();
            if (!candle)
                continue;
            if (candle.canonicalAssetId !== asset.canonicalAssetId || candle.feedId !== asset.feedId) {
                remaining.push(candle);
                continue;
            }
            const decision = await this.handleCandle(candle, asset);
            if (decision)
                decisions.push(decision);
        }
        this.emittedCandles.push(...remaining);
        if (decisions.length === 0)
            return;
        const arbitrated = this.episodeArbitrator.arbitrate(decisions, nowMs);
        for (const decision of arbitrated) {
            await this.journal.appendDecision(decision);
            if (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT')
                this.pendingEntries.set(decision.decisionId, decision);
        }
    }
    async handleCandle(candle, asset) {
        await this.journal.appendCandle(candle);
        if (candle.lifecycle !== 'CLOSED')
            return null;
        const history = asset.candles.get(candle.timeframe);
        if (!history)
            return null;
        history.push(candle);
        if (history.length > this.config.maxCandlesPerTimeframe)
            history.splice(0, history.length - this.config.maxCandlesPerTimeframe);
        const coreReady = history.filter((item) => item.close !== null).length >= 5;
        const features = coreReady ? this.featureEngine.compute({
            candles: history,
            ticks: asset.ticks,
            cutoffTimestamp: candle.endTimestamp,
            computedAt: this.currentNow,
        }) : null;
        const regime = features ? this.regimeDetector.detect(features) : { structure: 'UNKNOWN', volatility: 'UNKNOWN' };
        const health = this.getAssetFeedOperationalHealth(asset.canonicalAssetId, asset.feedId, this.currentNow);
        const operationalDataState = this.decisionOperationalState(health.state, coreReady, candle.quality === 'GAP_AFFECTED');
        return this.decisionEngine.evaluate({
            canonicalAssetId: candle.canonicalAssetId,
            timeframe: candle.timeframe,
            candleStartTimestamp: candle.startTimestamp,
            candleEndTimestamp: candle.endTimestamp,
            computedAt: this.currentNow,
            features,
            regime,
            eventIntegrity: asset.latestTick?.integrity ?? 'INVALID',
            operationalDataState,
            sourceQuality: asset.latestTick?.sourceQuality ?? 'UNKNOWN',
            sourceFeedId: asset.latestTick?.marketSourceIdentity.feedId ?? asset.feedId,
            sourceProtocolVerificationId: asset.latestTick?.protocolVerificationId ?? null,
        });
    }
    decisionOperationalState(feedState, coreReady, gapAffected) {
        if (feedState === 'STALE' || feedState === 'DATA_UNAVAILABLE' || feedState === 'INITIALIZING')
            return feedState;
        if (!coreReady)
            return 'WARMING_UP';
        if (gapAffected || feedState === 'DEGRADED')
            return 'DEGRADED';
        return 'HEALTHY';
    }
    async resolveExistingEntries(tick) {
        for (const [decisionId, decision] of [...this.pendingEntries]) {
            if (decision.canonicalAssetId !== tick.marketSourceIdentity.canonicalAssetId)
                continue;
            if (decision.sourceFeedId !== tick.marketSourceIdentity.feedId)
                continue;
            const payoutSnapshot = this.payoutByAssetAndFeed.get(this.payoutKey(decision.canonicalAssetId, tick.marketSourceIdentity.feedId)) ?? null;
            const outcome = this.entryResolver.resolveFromTick(decision, tick, payoutSnapshot);
            if (!outcome)
                continue;
            this.pendingEntries.delete(decisionId);
            await this.journal.appendEntryResolution(outcome.entry);
            if (outcome.signal) {
                await this.journal.appendSignal(outcome.signal);
                await this.journal.appendDecisionSignalLink({ decisionId, signalId: outcome.signal.signalId, linkedAt: tick.receivedAtEpochMs });
                this.pendingSignals.set(outcome.signal.signalId, outcome.signal);
            }
        }
    }
    async resolveExistingResults(tick) {
        for (const [signalId, signal] of [...this.pendingSignals]) {
            if (signal.canonicalAssetId !== tick.marketSourceIdentity.canonicalAssetId)
                continue;
            if (signal.entryMarketSourceIdentity.feedId !== tick.marketSourceIdentity.feedId)
                continue;
            const result = this.resultEngine.evaluateFromTick(signal, tick);
            if (!result)
                continue;
            this.pendingSignals.delete(signalId);
            await this.journal.appendResult(result);
        }
    }
    payoutKey(canonicalAssetId, feedId) {
        return `${canonicalAssetId}:${feedId ?? 'UNKNOWN'}`;
    }
    assetKey(canonicalAssetId, feedId) {
        return `${canonicalAssetId}::${feedId}`;
    }
    healthForDecision(decision, nowMs) {
        if (decision.sourceFeedId === null)
            return assessOperationalHealth(null, decision.createdAt, nowMs, this.config.dataHealthThresholds);
        return this.getAssetFeedOperationalHealth(decision.canonicalAssetId, decision.sourceFeedId, nowMs);
    }
    healthForSignal(signal, nowMs) {
        return this.getAssetFeedOperationalHealth(signal.canonicalAssetId, signal.entryMarketSourceIdentity.feedId, nowMs);
    }
    entryTimeoutReason(state) {
        if (state === 'DATA_UNAVAILABLE')
            return 'DATA_UNAVAILABLE';
        if (state === 'STALE')
            return 'FEED_STALE';
        return 'ENTRY_TIMEOUT';
    }
    resultTimeoutReason(state) {
        if (state === 'DATA_UNAVAILABLE')
            return 'DATA_UNAVAILABLE';
        if (state === 'STALE')
            return 'ASSET_FEED_LOST';
        return 'EXPIRY_TIMEOUT';
    }
    async expirePending(nowMs) {
        for (const [decisionId, decision] of [...this.pendingEntries]) {
            const state = this.healthForDecision(decision, nowMs).state;
            const timeout = this.entryResolver.timeout(decision, nowMs, this.entryTimeoutReason(state));
            if (!timeout)
                continue;
            this.pendingEntries.delete(decisionId);
            await this.journal.appendEntryResolution(timeout);
        }
        for (const [signalId, signal] of [...this.pendingSignals]) {
            const state = this.healthForSignal(signal, nowMs).state;
            const timeout = this.resultEngine.timeout(signal, nowMs, this.resultTimeoutReason(state));
            if (!timeout)
                continue;
            this.pendingSignals.delete(signalId);
            await this.journal.appendResult(timeout);
        }
    }
    restoreDecisionEpisode(decision, nowMs) {
        if (decision.marketEpisodeId === null || decision.sourceFeedId === null || (decision.finalDecision !== 'CALL' && decision.finalDecision !== 'PUT'))
            return;
        this.episodeArbitrator.restoreActiveEpisode({
            marketEpisodeId: decision.marketEpisodeId,
            canonicalAssetId: decision.canonicalAssetId,
            feedId: decision.sourceFeedId,
            direction: decision.finalDecision,
            primaryDecisionId: decision.decisionId,
            expiresAt: decision.decisionPublishedAt + this.config.episodeHorizonMs,
        }, nowMs);
    }
    restoreSignalEpisode(signal, nowMs) {
        this.episodeArbitrator.restoreActiveEpisode({
            marketEpisodeId: signal.marketEpisodeId,
            canonicalAssetId: signal.canonicalAssetId,
            feedId: signal.entryMarketSourceIdentity.feedId,
            direction: signal.direction,
            primaryDecisionId: signal.decisionId,
            expiresAt: signal.expectedExpiryTimestamp + this.config.maxExpiryResolutionDelayMs,
        }, nowMs);
    }
}
