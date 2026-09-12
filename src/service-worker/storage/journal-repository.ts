import type { Candle, PayoutSnapshot, Tick } from '../../common/models/types.js';
import type {
  DecisionRecord,
  DecisionSignalLink,
  EntryResolutionRecord,
  ResultRecord,
  SignalRecord,
} from '../../common/models/journal-types.js';

export interface JournalSnapshot {
  ticks: Tick[];
  payoutSnapshots: PayoutSnapshot[];
  candles: Candle[];
  decisions: DecisionRecord[];
  entryResolutions: EntryResolutionRecord[];
  decisionSignalLinks: DecisionSignalLink[];
  signals: SignalRecord[];
  results: ResultRecord[];
}

export interface JournalRepository {
  appendTick(tick: Tick): Promise<void>;
  appendPayoutSnapshot(payout: PayoutSnapshot): Promise<void>;
  appendCandle(candle: Candle): Promise<void>;
  appendDecision(decision: DecisionRecord): Promise<void>;
  appendEntryResolution(entry: EntryResolutionRecord): Promise<void>;
  appendDecisionSignalLink(link: DecisionSignalLink): Promise<void>;
  appendSignal(signal: SignalRecord): Promise<void>;
  appendResult(result: ResultRecord): Promise<void>;
  snapshot(): Promise<JournalSnapshot>;
}
