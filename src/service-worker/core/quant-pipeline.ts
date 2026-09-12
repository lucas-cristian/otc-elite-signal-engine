import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
import type { DecisionRecord, SignalRecord } from '../../common/models/journal-types.js';
import type { Candle, OperationalDataState, PayoutSnapshot, Tick, Timeframe } from '../../common/models/types.js';
import type { ValidatedMarketObservation } from '../../common/protocol/market-events.js';
import { PROTOCOL_VERIFICATION_REGISTRY_VERSION } from '../../common/protocol/protocol-verification-registry.js';
import { CandleBuilder } from '../engine/candle-builder.js';
import { FeatureEngine } from '../engine/feature-engine.js';
import { RegimeDetector } from '../engine/regime-detector.js';
import { DecisionEngine } from '../engine/decision/decision-engine.js';
import { EntryResolver } from '../engine/decision/entry-resolver.js';
import { ResultEngine } from '../evaluation/result-engine.js';
import type { JournalRepository } from '../storage/journal-repository.js';
import { RecoveryService } from '../storage/recovery-service.js';
import {
  assessOperationalHealth,
  DEFAULT_DATA_HEALTH_THRESHOLDS,
  type DataHealthThresholds,
  type OperationalHealthSnapshot,
  validateDataHealthThresholds,
} from './data-health.js';
import { MarketEpisodeArbitrator } from './market-episode-arbitrator.js';

interface AssetRuntime {
  canonicalAssetId: string;
  feedId: string;
  builders: Map<Timeframe, CandleBuilder>;
  candles: Map<Timeframe, Candle[]>;
  ticks: Tick[];
  latestTick: Tick | null;
  startedAt: number;
}

export interface AssetFeedHealthSnapshot extends OperationalHealthSnapshot {
  canonicalAssetId: string;
  feedId: string;
}

export interface QuantPipelineConfig {
  appVersion: string;
  executionMode: 'LIVE' | 'REPLAY';
  timeframes: readonly Timeframe[];
  expirationSeconds: number;
  minModelScore: number;
  maxEntryResolutionDelayMs: number;
  maxExpiryResolutionDelayMs: number;
  maxHotTicks: number;
  maxCandlesPerTimeframe: number;
  dataHealthThresholds: DataHealthThresholds;
  arbitrationConflictScoreMargin: number;
  episodeHorizonMs: number;
}

export const DEFAULT_PIPELINE_CONFIG: QuantPipelineConfig = {
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
  private readonly assets = new Map<string, AssetRuntime>();
  private readonly featureEngine = new FeatureEngine();
  private readonly regimeDetector = new RegimeDetector();
  private readonly entryResolver: EntryResolver;
  private readonly resultEngine: ResultEngine;
  private readonly decisionEngine: DecisionEngine;
  private readonly episodeArbitrator: MarketEpisodeArbitrator;
  private readonly pendingEntries = new Map<string, DecisionRecord>();
  private readonly pendingSignals = new Map<string, SignalRecord>();
  private readonly payoutByAssetAndFeed = new Map<string, PayoutSnapshot>();
  private readonly emittedCandles: Candle[] = [];
  private processing: Promise<void> = Promise.resolve();
  private currentNow = 0;
  private startedAt = 0;
  private latestTick: Tick | null = null;

  public constructor(
    private readonly journal: JournalRepository,
    private readonly config: QuantPipelineConfig,
  ) {
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

  public async initialize(nowMs: number): Promise<void> {
    this.startedAt = nowMs;
    this.currentNow = nowMs;
    const recovery = await new RecoveryService(this.journal).derive();
    this.latestTick = recovery.latestTick;
    for (const tick of recovery.latestTicksByAssetFeed) this.restoreLatestTick(tick);
    for (const payout of recovery.latestPayoutSnapshots) {
      this.payoutByAssetAndFeed.set(this.payoutKey(payout.canonicalAssetId, payout.feedId), payout);
    }
    for (const decision of recovery.pendingEntries) {
      const health = this.healthForDecision(decision, nowMs);
      const timeout = this.entryResolver.timeout(decision, nowMs, this.entryTimeoutReason(health.state));
      if (timeout) await this.journal.appendEntryResolution(timeout);
      else {
        this.pendingEntries.set(decision.decisionId, decision);
        this.restoreDecisionEpisode(decision, nowMs);
      }
    }
    for (const signal of recovery.pendingResults) {
      const health = this.healthForSignal(signal, nowMs);
      const timeout = this.resultEngine.timeout(signal, nowMs, this.resultTimeoutReason(health.state));
      if (timeout) await this.journal.appendResult(timeout);
      else {
        this.pendingSignals.set(signal.signalId, signal);
        this.restoreSignalEpisode(signal, nowMs);
      }
    }
  }

  public enqueue(observation: ValidatedMarketObservation): Promise<void> {
    this.processing = this.processing.then(() => this.processObservation(observation));
    return this.processing;
  }

  public enqueuePayout(payoutSnapshot: PayoutSnapshot): Promise<void> {
    this.processing = this.processing.then(() => this.processPayout(payoutSnapshot));
    return this.processing;
  }

  public watchdog(nowMs: number): Promise<void> {
    this.processing = this.processing.then(() => this.processWatchdog(nowMs));
    return this.processing;
  }

  public getOperationalHealth(nowMs: number): OperationalHealthSnapshot {
    return assessOperationalHealth(
      this.latestTick?.receivedAtEpochMs ?? null,
      this.startedAt,
      nowMs,
      this.config.dataHealthThresholds,
    );
  }

  public getAssetFeedOperationalHealth(canonicalAssetId: string, feedId: string, nowMs: number): AssetFeedHealthSnapshot {
    const runtime = this.assets.get(this.assetKey(canonicalAssetId, feedId));
    const health = assessOperationalHealth(
      runtime?.latestTick?.receivedAtEpochMs ?? null,
      runtime?.startedAt ?? this.startedAt,
      nowMs,
      this.config.dataHealthThresholds,
    );
    return { canonicalAssetId, feedId, ...health };
  }

  public getAllAssetFeedOperationalHealth(nowMs: number): AssetFeedHealthSnapshot[] {
    return [...this.assets.values()]
      .map((runtime) => this.getAssetFeedOperationalHealth(runtime.canonicalAssetId, runtime.feedId, nowMs))
      .sort((a, b) => a.canonicalAssetId.localeCompare(b.canonicalAssetId) || a.feedId.localeCompare(b.feedId));
  }

  public getActiveEpisodeCount(nowMs: number): number {
    return this.episodeArbitrator.activeEpisodeCount(nowMs);
  }

  public async drain(): Promise<void> {
    await this.processing;
  }

  public async finalizeThrough(nowMs: number): Promise<void> {
    await this.watchdog(nowMs);
  }

  private async processObservation(observation: ValidatedMarketObservation): Promise<void> {
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
    if (asset.ticks.length > this.config.maxHotTicks) asset.ticks.splice(0, asset.ticks.length - this.config.maxHotTicks);
    for (const builder of asset.builders.values()) builder.ingest(tick);
    await this.drainCandles(asset, tick.receivedAtEpochMs);
  }

  private async processPayout(payoutSnapshot: PayoutSnapshot): Promise<void> {
    this.currentNow = Math.max(this.currentNow, payoutSnapshot.capturedAt);
    this.payoutByAssetAndFeed.set(this.payoutKey(payoutSnapshot.canonicalAssetId, payoutSnapshot.feedId), payoutSnapshot);
    await this.journal.appendPayoutSnapshot(payoutSnapshot);
  }

  private async processWatchdog(nowMs: number): Promise<void> {
    this.currentNow = Math.max(this.currentNow, nowMs);
    for (const asset of this.assets.values()) {
      for (const builder of asset.builders.values()) builder.advanceClock(nowMs);
      await this.drainCandles(asset, nowMs);
    }
    await this.expirePending(nowMs);
  }

  private assetRuntime(canonicalAssetId: string, feedId: string, startedAt = this.currentNow): AssetRuntime {
    const key = this.assetKey(canonicalAssetId, feedId);
    const existing = this.assets.get(key);
    if (existing) return existing;
    const candles = new Map<Timeframe, Candle[]>();
    const builders = new Map<Timeframe, CandleBuilder>();
    for (const timeframe of this.config.timeframes) {
      candles.set(timeframe, []);
      builders.set(timeframe, new CandleBuilder(canonicalAssetId, feedId, timeframe, (candle) => this.emittedCandles.push(candle)));
    }
    const created: AssetRuntime = { canonicalAssetId, feedId, builders, candles, ticks: [], latestTick: null, startedAt };
    this.assets.set(key, created);
    return created;
  }

  private restoreLatestTick(tick: Tick): void {
    const runtime = this.assetRuntime(tick.marketSourceIdentity.canonicalAssetId, tick.marketSourceIdentity.feedId, tick.receivedAtEpochMs);
    if (runtime.latestTick === null || tick.receivedAtEpochMs > runtime.latestTick.receivedAtEpochMs) runtime.latestTick = tick;
  }

  private async drainCandles(asset: AssetRuntime, nowMs: number): Promise<void> {
    const decisions: DecisionRecord[] = [];
    const remaining: Candle[] = [];
    while (this.emittedCandles.length > 0) {
      const candle = this.emittedCandles.shift();
      if (!candle) continue;
      if (candle.canonicalAssetId !== asset.canonicalAssetId || candle.feedId !== asset.feedId) {
        remaining.push(candle);
        continue;
      }
      const decision = await this.handleCandle(candle, asset);
      if (decision) decisions.push(decision);
    }
    this.emittedCandles.push(...remaining);
    if (decisions.length === 0) return;
    const arbitrated = this.episodeArbitrator.arbitrate(decisions, nowMs);
    for (const decision of arbitrated) {
      await this.journal.appendDecision(decision);
      if (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT') this.pendingEntries.set(decision.decisionId, decision);
    }
  }

  private async handleCandle(candle: Candle, asset: AssetRuntime): Promise<DecisionRecord | null> {
    await this.journal.appendCandle(candle);
    if (candle.lifecycle !== 'CLOSED') return null;
    const history = asset.candles.get(candle.timeframe);
    if (!history) return null;
    history.push(candle);
    if (history.length > this.config.maxCandlesPerTimeframe) history.splice(0, history.length - this.config.maxCandlesPerTimeframe);
    const coreReady = history.filter((item) => item.close !== null).length >= 5;
    const features = coreReady ? this.featureEngine.compute({
      candles: history,
      ticks: asset.ticks,
      cutoffTimestamp: candle.endTimestamp,
      computedAt: this.currentNow,
    }) : null;
    const regime = features ? this.regimeDetector.detect(features) : { structure: 'UNKNOWN' as const, volatility: 'UNKNOWN' as const };
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

  private decisionOperationalState(feedState: OperationalDataState, coreReady: boolean, gapAffected: boolean): OperationalDataState {
    if (feedState === 'STALE' || feedState === 'DATA_UNAVAILABLE' || feedState === 'INITIALIZING') return feedState;
    if (!coreReady) return 'WARMING_UP';
    if (gapAffected || feedState === 'DEGRADED') return 'DEGRADED';
    return 'HEALTHY';
  }

  private async resolveExistingEntries(tick: Tick): Promise<void> {
    for (const [decisionId, decision] of [...this.pendingEntries]) {
      if (decision.canonicalAssetId !== tick.marketSourceIdentity.canonicalAssetId) continue;
      if (decision.sourceFeedId !== tick.marketSourceIdentity.feedId) continue;
      const payoutSnapshot = this.payoutByAssetAndFeed.get(this.payoutKey(decision.canonicalAssetId, tick.marketSourceIdentity.feedId)) ?? null;
      const outcome = this.entryResolver.resolveFromTick(decision, tick, payoutSnapshot);
      if (!outcome) continue;
      this.pendingEntries.delete(decisionId);
      await this.journal.appendEntryResolution(outcome.entry);
      if (outcome.signal) {
        await this.journal.appendSignal(outcome.signal);
        await this.journal.appendDecisionSignalLink({ decisionId, signalId: outcome.signal.signalId, linkedAt: tick.receivedAtEpochMs });
        this.pendingSignals.set(outcome.signal.signalId, outcome.signal);
      }
    }
  }

  private async resolveExistingResults(tick: Tick): Promise<void> {
    for (const [signalId, signal] of [...this.pendingSignals]) {
      if (signal.canonicalAssetId !== tick.marketSourceIdentity.canonicalAssetId) continue;
      if (signal.entryMarketSourceIdentity.feedId !== tick.marketSourceIdentity.feedId) continue;
      const result = this.resultEngine.evaluateFromTick(signal, tick);
      if (!result) continue;
      this.pendingSignals.delete(signalId);
      await this.journal.appendResult(result);
    }
  }

  private payoutKey(canonicalAssetId: string, feedId: string | null): string {
    return `${canonicalAssetId}:${feedId ?? 'UNKNOWN'}`;
  }

  private assetKey(canonicalAssetId: string, feedId: string): string {
    return `${canonicalAssetId}::${feedId}`;
  }

  private healthForDecision(decision: DecisionRecord, nowMs: number): OperationalHealthSnapshot {
    if (decision.sourceFeedId === null) return assessOperationalHealth(null, decision.createdAt, nowMs, this.config.dataHealthThresholds);
    return this.getAssetFeedOperationalHealth(decision.canonicalAssetId, decision.sourceFeedId, nowMs);
  }

  private healthForSignal(signal: SignalRecord, nowMs: number): OperationalHealthSnapshot {
    return this.getAssetFeedOperationalHealth(signal.canonicalAssetId, signal.entryMarketSourceIdentity.feedId, nowMs);
  }

  private entryTimeoutReason(state: OperationalDataState): 'ENTRY_TIMEOUT' | 'FEED_STALE' | 'DATA_UNAVAILABLE' {
    if (state === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
    if (state === 'STALE') return 'FEED_STALE';
    return 'ENTRY_TIMEOUT';
  }

  private resultTimeoutReason(state: OperationalDataState): 'EXPIRY_TIMEOUT' | 'ASSET_FEED_LOST' | 'DATA_UNAVAILABLE' {
    if (state === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
    if (state === 'STALE') return 'ASSET_FEED_LOST';
    return 'EXPIRY_TIMEOUT';
  }

  private async expirePending(nowMs: number): Promise<void> {
    for (const [decisionId, decision] of [...this.pendingEntries]) {
      const state = this.healthForDecision(decision, nowMs).state;
      const timeout = this.entryResolver.timeout(decision, nowMs, this.entryTimeoutReason(state));
      if (!timeout) continue;
      this.pendingEntries.delete(decisionId);
      await this.journal.appendEntryResolution(timeout);
    }
    for (const [signalId, signal] of [...this.pendingSignals]) {
      const state = this.healthForSignal(signal, nowMs).state;
      const timeout = this.resultEngine.timeout(signal, nowMs, this.resultTimeoutReason(state));
      if (!timeout) continue;
      this.pendingSignals.delete(signalId);
      await this.journal.appendResult(timeout);
    }
  }

  private restoreDecisionEpisode(decision: DecisionRecord, nowMs: number): void {
    if (decision.marketEpisodeId === null || decision.sourceFeedId === null || (decision.finalDecision !== 'CALL' && decision.finalDecision !== 'PUT')) return;
    this.episodeArbitrator.restoreActiveEpisode({
      marketEpisodeId: decision.marketEpisodeId,
      canonicalAssetId: decision.canonicalAssetId,
      feedId: decision.sourceFeedId,
      direction: decision.finalDecision,
      primaryDecisionId: decision.decisionId,
      expiresAt: decision.decisionPublishedAt + this.config.episodeHorizonMs,
    }, nowMs);
  }

  private restoreSignalEpisode(signal: SignalRecord, nowMs: number): void {
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
