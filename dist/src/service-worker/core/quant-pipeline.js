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
export const DEFAULT_PIPELINE_CONFIG = {
    appVersion: '1.4.0',
    executionMode: 'LIVE',
    timeframes: ['5s', '10s', '15s', '30s', '60s'],
    expirationSeconds: 60,
    minModelScore: 0.35,
    maxEntryResolutionDelayMs: 3_000,
    maxExpiryResolutionDelayMs: 5_000,
    maxHotTicks: 2_000,
    maxCandlesPerTimeframe: 200,
    dataHealthThresholds: DEFAULT_DATA_HEALTH_THRESHOLDS,
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
        const configSnapshot = {
            timeframes: config.timeframes,
            expirationSeconds: config.expirationSeconds,
            minModelScore: config.minModelScore,
            maxEntryResolutionDelayMs: config.maxEntryResolutionDelayMs,
            maxExpiryResolutionDelayMs: config.maxExpiryResolutionDelayMs,
            dataHealthThresholds: config.dataHealthThresholds,
            protocolRegistryVersion: PROTOCOL_VERIFICATION_REGISTRY_VERSION,
        };
        this.decisionEngine = new DecisionEngine({
            executionMode: config.executionMode,
            appVersion: config.appVersion,
            configHash: canonicalEntityHash('CONFIG', 2, configSnapshot),
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
        for (const payout of recovery.latestPayoutSnapshots) {
            this.payoutByAssetAndFeed.set(this.payoutKey(payout.canonicalAssetId, payout.feedId), payout);
        }
        const health = this.getOperationalHealth(nowMs);
        for (const decision of recovery.pendingEntries) {
            const timeout = this.entryResolver.timeout(decision, nowMs, this.entryTimeoutReason(health.state));
            if (timeout)
                await this.journal.appendEntryResolution(timeout);
            else
                this.pendingEntries.set(decision.decisionId, decision);
        }
        for (const signal of recovery.pendingResults) {
            const timeout = this.resultEngine.timeout(signal, nowMs, health.state === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'EXPIRY_TIMEOUT');
            if (timeout)
                await this.journal.appendResult(timeout);
            else
                this.pendingSignals.set(signal.signalId, signal);
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
    async drain() {
        await this.processing;
    }
    async finalizeThrough(nowMs) {
        await this.watchdog(nowMs);
    }
    async processObservation(observation) {
        const tick = observation.tick;
        this.currentNow = Math.max(this.currentNow, tick.receivedAtEpochMs);
        this.latestTick = tick;
        await this.journal.appendTick(tick);
        await this.resolveExistingEntries(tick);
        await this.resolveExistingResults(tick);
        await this.expirePending(tick.receivedAtEpochMs, this.getOperationalHealth(tick.receivedAtEpochMs).state);
        const asset = this.assetRuntime(tick.marketSourceIdentity.canonicalAssetId);
        asset.ticks.push(tick);
        if (asset.ticks.length > this.config.maxHotTicks)
            asset.ticks.splice(0, asset.ticks.length - this.config.maxHotTicks);
        for (const builder of asset.builders.values())
            builder.ingest(tick);
        while (this.emittedCandles.length > 0) {
            const candle = this.emittedCandles.shift();
            if (candle)
                await this.handleCandle(candle, asset);
        }
    }
    async processPayout(payoutSnapshot) {
        this.currentNow = Math.max(this.currentNow, payoutSnapshot.capturedAt);
        this.payoutByAssetAndFeed.set(this.payoutKey(payoutSnapshot.canonicalAssetId, payoutSnapshot.feedId), payoutSnapshot);
        await this.journal.appendPayoutSnapshot(payoutSnapshot);
    }
    async processWatchdog(nowMs) {
        this.currentNow = Math.max(this.currentNow, nowMs);
        const health = this.getOperationalHealth(nowMs);
        await this.expirePending(nowMs, health.state);
    }
    assetRuntime(canonicalAssetId) {
        const existing = this.assets.get(canonicalAssetId);
        if (existing)
            return existing;
        const candles = new Map();
        const builders = new Map();
        for (const timeframe of this.config.timeframes) {
            candles.set(timeframe, []);
            builders.set(timeframe, new CandleBuilder(canonicalAssetId, timeframe, (candle) => this.emittedCandles.push(candle)));
        }
        const created = { builders, candles, ticks: [] };
        this.assets.set(canonicalAssetId, created);
        return created;
    }
    async handleCandle(candle, asset) {
        await this.journal.appendCandle(candle);
        if (candle.lifecycle !== 'CLOSED')
            return;
        const history = asset.candles.get(candle.timeframe);
        if (!history)
            return;
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
        const health = this.getOperationalHealth(this.currentNow);
        const operationalDataState = this.decisionOperationalState(health.state, coreReady, candle.quality === 'GAP_AFFECTED');
        const decision = this.decisionEngine.evaluate({
            canonicalAssetId: candle.canonicalAssetId,
            timeframe: candle.timeframe,
            candleStartTimestamp: candle.startTimestamp,
            candleEndTimestamp: candle.endTimestamp,
            computedAt: this.currentNow,
            features,
            regime,
            eventIntegrity: this.latestTick?.integrity ?? 'INVALID',
            operationalDataState,
            sourceQuality: this.latestTick?.sourceQuality ?? 'UNKNOWN',
            sourceProtocolVerificationId: this.latestTick?.protocolVerificationId ?? null,
        });
        await this.journal.appendDecision(decision);
        if (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT')
            this.pendingEntries.set(decision.decisionId, decision);
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
    entryTimeoutReason(state) {
        if (state === 'DATA_UNAVAILABLE')
            return 'DATA_UNAVAILABLE';
        if (state === 'STALE')
            return 'FEED_STALE';
        return 'ENTRY_TIMEOUT';
    }
    async expirePending(nowMs, state) {
        for (const [decisionId, decision] of [...this.pendingEntries]) {
            const timeout = this.entryResolver.timeout(decision, nowMs, this.entryTimeoutReason(state));
            if (!timeout)
                continue;
            this.pendingEntries.delete(decisionId);
            await this.journal.appendEntryResolution(timeout);
        }
        for (const [signalId, signal] of [...this.pendingSignals]) {
            const timeout = this.resultEngine.timeout(signal, nowMs, state === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'EXPIRY_TIMEOUT');
            if (!timeout)
                continue;
            this.pendingSignals.delete(signalId);
            await this.journal.appendResult(timeout);
        }
    }
}
