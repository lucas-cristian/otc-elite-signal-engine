import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
import type { DecisionRecord, SignalRecord } from '../../common/models/journal-types.js';
import type { Candle, PayoutSnapshot, Tick, Timeframe } from '../../common/models/types.js';
import type { ValidatedMarketObservation } from '../../common/protocol/market-events.js';
import { CandleBuilder } from '../engine/candle-builder.js';
import { FeatureEngine } from '../engine/feature-engine.js';
import { RegimeDetector } from '../engine/regime-detector.js';
import { DecisionEngine } from '../engine/decision/decision-engine.js';
import { EntryResolver } from '../engine/decision/entry-resolver.js';
import { ResultEngine } from '../evaluation/result-engine.js';
import type { JournalRepository } from '../storage/journal-repository.js';
import { RecoveryService } from '../storage/recovery-service.js';

interface AssetRuntime {
  builders: Map<Timeframe, CandleBuilder>;
  candles: Map<Timeframe, Candle[]>;
  ticks: Tick[];
}

export interface QuantPipelineConfig {
  appVersion: string;
  executionMode: 'LIVE' | 'REPLAY';
  timeframes: readonly Timeframe[];
  expirationSeconds: number;
  minModelScore: number;
  maxEntryResolutionDelayMs: number;
  maxExpiryResolutionDelayMs: number;
  protocolSchemaVerified: boolean;
  maxHotTicks: number;
  maxCandlesPerTimeframe: number;
}

export const DEFAULT_PIPELINE_CONFIG: QuantPipelineConfig = {
  appVersion: '1.1.0',
  executionMode: 'LIVE',
  timeframes: ['5s', '10s', '15s', '30s', '60s'],
  expirationSeconds: 60,
  minModelScore: 0.35,
  maxEntryResolutionDelayMs: 3_000,
  maxExpiryResolutionDelayMs: 5_000,
  protocolSchemaVerified: false,
  maxHotTicks: 2_000,
  maxCandlesPerTimeframe: 200,
};

export class QuantPipeline {
  private readonly assets = new Map<string, AssetRuntime>();
  private readonly featureEngine = new FeatureEngine();
  private readonly regimeDetector = new RegimeDetector();
  private readonly entryResolver: EntryResolver;
  private readonly resultEngine: ResultEngine;
  private readonly decisionEngine: DecisionEngine;
  private readonly pendingEntries = new Map<string, DecisionRecord>();
  private readonly pendingSignals = new Map<string, SignalRecord>();
  private readonly payoutByAsset = new Map<string, PayoutSnapshot>();
  private readonly emittedCandles: Candle[] = [];
  private processing: Promise<void> = Promise.resolve();
  private currentNow = 0;
  private latestTick: Tick | null = null;

  public constructor(
    private readonly journal: JournalRepository,
    private readonly config: QuantPipelineConfig,
  ) {
    this.entryResolver = new EntryResolver(config.maxEntryResolutionDelayMs);
    this.resultEngine = new ResultEngine(config.maxExpiryResolutionDelayMs);
    const configSnapshot = {
      timeframes: config.timeframes,
      expirationSeconds: config.expirationSeconds,
      minModelScore: config.minModelScore,
      maxEntryResolutionDelayMs: config.maxEntryResolutionDelayMs,
      maxExpiryResolutionDelayMs: config.maxExpiryResolutionDelayMs,
      protocolSchemaVerified: config.protocolSchemaVerified,
    };
    this.decisionEngine = new DecisionEngine({
      executionMode: config.executionMode,
      appVersion: config.appVersion,
      configHash: canonicalEntityHash('CONFIG', 1, configSnapshot),
      configSnapshot,
      expirationSeconds: config.expirationSeconds,
      minModelScore: config.minModelScore,
    });
  }

  public async initialize(nowMs: number): Promise<void> {
    const recovery = await new RecoveryService(this.journal).derive();
    for (const decision of recovery.pendingEntries) {
      const timeout = this.entryResolver.timeout(decision, nowMs);
      if (timeout) await this.journal.appendEntryResolution(timeout);
      else this.pendingEntries.set(decision.decisionId, decision);
    }
    for (const signal of recovery.pendingResults) {
      const timeout = this.resultEngine.timeout(signal, nowMs);
      if (timeout) await this.journal.appendResult(timeout);
      else this.pendingSignals.set(signal.signalId, signal);
    }
  }

  public enqueue(observation: ValidatedMarketObservation): Promise<void> {
    this.processing = this.processing.then(() => this.processObservation(observation));
    return this.processing;
  }

  public async drain(): Promise<void> {
    await this.processing;
  }

  private async processObservation(observation: ValidatedMarketObservation): Promise<void> {
    const tick = observation.tick;
    this.currentNow = tick.receivedAtEpochMs;
    this.latestTick = tick;
    if (observation.payoutSnapshot?.canonicalAssetId === tick.marketSourceIdentity.canonicalAssetId) {
      this.payoutByAsset.set(observation.payoutSnapshot.canonicalAssetId, observation.payoutSnapshot);
      await this.journal.appendPayoutSnapshot(observation.payoutSnapshot);
    }
    await this.journal.appendTick(tick);
    await this.resolveExistingEntries(tick);
    await this.resolveExistingResults(tick);
    await this.expirePending(tick.receivedAtEpochMs);
    const asset = this.assetRuntime(tick.marketSourceIdentity.canonicalAssetId);
    asset.ticks.push(tick);
    if (asset.ticks.length > this.config.maxHotTicks) asset.ticks.splice(0, asset.ticks.length - this.config.maxHotTicks);
    for (const builder of asset.builders.values()) builder.ingest(tick);
    while (this.emittedCandles.length > 0) {
      const candle = this.emittedCandles.shift();
      if (candle) await this.handleCandle(candle, asset);
    }
  }

  private assetRuntime(canonicalAssetId: string): AssetRuntime {
    const existing = this.assets.get(canonicalAssetId);
    if (existing) return existing;
    const candles = new Map<Timeframe, Candle[]>();
    const builders = new Map<Timeframe, CandleBuilder>();
    for (const timeframe of this.config.timeframes) {
      candles.set(timeframe, []);
      builders.set(timeframe, new CandleBuilder(canonicalAssetId, timeframe, (candle) => this.emittedCandles.push(candle)));
    }
    const created: AssetRuntime = { builders, candles, ticks: [] };
    this.assets.set(canonicalAssetId, created);
    return created;
  }

  private async handleCandle(candle: Candle, asset: AssetRuntime): Promise<void> {
    await this.journal.appendCandle(candle);
    if (candle.lifecycle !== 'CLOSED') return;
    const history = asset.candles.get(candle.timeframe);
    if (!history) return;
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
    const operationalDataState = candle.quality === 'GAP_AFFECTED' ? 'DEGRADED' as const : coreReady ? 'HEALTHY' as const : 'WARMING_UP' as const;
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
      sourceQuality: this.config.protocolSchemaVerified ? 'VERIFIED' : 'INFERRED',
    });
    await this.journal.appendDecision(decision);
    if (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT') this.pendingEntries.set(decision.decisionId, decision);
  }

  private async resolveExistingEntries(tick: Tick): Promise<void> {
    for (const [decisionId, decision] of [...this.pendingEntries]) {
      if (decision.canonicalAssetId !== tick.marketSourceIdentity.canonicalAssetId) continue;
      const outcome = this.entryResolver.resolveFromTick(decision, tick, this.payoutByAsset.get(decision.canonicalAssetId) ?? null);
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
      const result = this.resultEngine.evaluateFromTick(signal, tick);
      if (!result) continue;
      this.pendingSignals.delete(signalId);
      await this.journal.appendResult(result);
    }
  }

  private async expirePending(nowMs: number): Promise<void> {
    for (const [decisionId, decision] of [...this.pendingEntries]) {
      const timeout = this.entryResolver.timeout(decision, nowMs);
      if (!timeout) continue;
      this.pendingEntries.delete(decisionId);
      await this.journal.appendEntryResolution(timeout);
    }
    for (const [signalId, signal] of [...this.pendingSignals]) {
      const timeout = this.resultEngine.timeout(signal, nowMs);
      if (!timeout) continue;
      this.pendingSignals.delete(signalId);
      await this.journal.appendResult(timeout);
    }
  }
}
