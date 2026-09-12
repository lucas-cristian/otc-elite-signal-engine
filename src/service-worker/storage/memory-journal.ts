import { canonicalJson } from '../../common/hashing/canonical-hash.js';
import type { FeedContinuityEvent } from '../../common/models/feed-continuity.js';
import type { TransportEventRecord } from '../../common/models/runtime-telemetry.js';
import type { Candle, PayoutSnapshot, Tick } from '../../common/models/types.js';
import type {
  DecisionRecord,
  DecisionSignalLink,
  EntryResolutionRecord,
  ResultRecord,
  SignalRecord,
} from '../../common/models/journal-types.js';
import type { JournalRepository, JournalSnapshot } from './journal-repository.js';

export class MemoryJournal implements JournalRepository {
  private readonly ticks = new Map<string, Tick>();
  private readonly payouts = new Map<string, PayoutSnapshot>();
  private readonly candles = new Map<string, Candle>();
  private readonly decisions = new Map<string, DecisionRecord>();
  private readonly entries = new Map<string, EntryResolutionRecord>();
  private readonly links = new Map<string, DecisionSignalLink>();
  private readonly signals = new Map<string, SignalRecord>();
  private readonly results = new Map<string, ResultRecord>();
  private readonly continuity = new Map<string, FeedContinuityEvent>();
  private readonly transport = new Map<string, TransportEventRecord>();

  public async appendTick(value: Tick): Promise<void> { this.append(this.ticks, value.tickId, value); }
  public async appendPayoutSnapshot(value: PayoutSnapshot): Promise<void> { this.append(this.payouts, `${value.canonicalAssetId}:${value.feedId ?? 'UNKNOWN'}:${value.expirationSeconds ?? 'ANY'}:${value.capturedAt}`, value); }
  public async appendCandle(value: Candle): Promise<void> { this.append(this.candles, this.candleKey(value), value); }
  public async appendDecision(value: DecisionRecord): Promise<void> { this.append(this.decisions, value.decisionId, value); }
  public async appendEntryResolution(value: EntryResolutionRecord): Promise<void> { this.append(this.entries, value.decisionId, value); }
  public async appendDecisionSignalLink(value: DecisionSignalLink): Promise<void> { this.append(this.links, value.decisionId, value); }
  public async appendSignal(value: SignalRecord): Promise<void> { this.append(this.signals, value.signalId, value); }
  public async appendResult(value: ResultRecord): Promise<void> { this.append(this.results, value.signalId, value); }
  public async appendContinuityEvent(value: FeedContinuityEvent): Promise<void> { this.append(this.continuity, value.continuityEventId, value); }
  public async appendTransportEvent(value: TransportEventRecord): Promise<void> { this.append(this.transport, value.transportEventId, value); }

  public async snapshot(): Promise<JournalSnapshot> {
    return {
      ticks: [...this.ticks.values()],
      payoutSnapshots: [...this.payouts.values()],
      candles: [...this.candles.values()],
      decisions: [...this.decisions.values()],
      entryResolutions: [...this.entries.values()],
      decisionSignalLinks: [...this.links.values()],
      signals: [...this.signals.values()],
      results: [...this.results.values()],
      continuityEvents: [...this.continuity.values()],
      transportEvents: [...this.transport.values()],
    };
  }

  private append<T>(map: Map<string, T>, key: string, value: T): void {
    const existing = map.get(key);
    if (existing && canonicalJson(existing) !== canonicalJson(value)) throw new Error(`Append-only conflict for ${key}`);
    if (!existing) map.set(key, value);
  }

  private candleKey(candle: Candle): string {
    return `${candle.canonicalAssetId}:${candle.feedId}:${candle.feedEpochId}:${candle.timeframe}:${candle.startTimestamp}:${candle.lifecycle}`;
  }
}
