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

interface StoredCandle { key: string; candle: Candle; }

type StoreName = 'ticks' | 'payoutSnapshots' | 'candles' | 'decisions' | 'entryResolutions' | 'decisionSignalLinks' | 'signals' | 'results' | 'continuityEvents' | 'transportEvents';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function openJournalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('otc-elite-signal-engine', 7);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      db.createObjectStore('ticks', { keyPath: 'tickId' });
      db.createObjectStore('payoutSnapshots', { keyPath: 'key' });
      db.createObjectStore('candles', { keyPath: 'key' });
      db.createObjectStore('decisions', { keyPath: 'decisionId' });
      db.createObjectStore('entryResolutions', { keyPath: 'decisionId' });
      db.createObjectStore('decisionSignalLinks', { keyPath: 'decisionId' });
      db.createObjectStore('signals', { keyPath: 'signalId' });
      db.createObjectStore('results', { keyPath: 'signalId' });
      db.createObjectStore('continuityEvents', { keyPath: 'continuityEventId' });
      db.createObjectStore('transportEvents', { keyPath: 'transportEventId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
  });
}

export class IndexedDbJournal implements JournalRepository {
  public constructor(private readonly db: IDBDatabase) {}

  public appendTick(value: Tick): Promise<void> { return this.appendImmutable('ticks', value.tickId, value); }
  public appendPayoutSnapshot(value: PayoutSnapshot): Promise<void> { const key = `${value.canonicalAssetId}:${value.feedId ?? 'UNKNOWN'}:${value.expirationSeconds ?? 'ANY'}:${value.capturedAt}`; return this.appendImmutable('payoutSnapshots', key, { key, payout: value }); }
  public appendCandle(value: Candle): Promise<void> {
    const key = `${value.canonicalAssetId}:${value.feedId}:${value.feedEpochId}:${value.timeframe}:${value.startTimestamp}:${value.lifecycle}`;
    return this.appendImmutable('candles', key, { key, candle: value });
  }
  public appendDecision(value: DecisionRecord): Promise<void> { return this.appendImmutable('decisions', value.decisionId, value); }
  public appendEntryResolution(value: EntryResolutionRecord): Promise<void> { return this.appendImmutable('entryResolutions', value.decisionId, value); }
  public appendDecisionSignalLink(value: DecisionSignalLink): Promise<void> { return this.appendImmutable('decisionSignalLinks', value.decisionId, value); }
  public appendSignal(value: SignalRecord): Promise<void> { return this.appendImmutable('signals', value.signalId, value); }
  public appendResult(value: ResultRecord): Promise<void> { return this.appendImmutable('results', value.signalId, value); }
  public appendContinuityEvent(value: FeedContinuityEvent): Promise<void> { return this.appendImmutable('continuityEvents', value.continuityEventId, value); }
  public appendTransportEvent(value: TransportEventRecord): Promise<void> { return this.appendImmutable('transportEvents', value.transportEventId, value); }

  public async snapshot(): Promise<JournalSnapshot> {
    const [ticks, storedPayouts, storedCandles, decisions, entries, links, signals, results, continuityEvents, transportEvents] = await Promise.all([
      this.all<Tick>('ticks'),
      this.all<{ key: string; payout: PayoutSnapshot }>('payoutSnapshots'),
      this.all<StoredCandle>('candles'),
      this.all<DecisionRecord>('decisions'),
      this.all<EntryResolutionRecord>('entryResolutions'),
      this.all<DecisionSignalLink>('decisionSignalLinks'),
      this.all<SignalRecord>('signals'),
      this.all<ResultRecord>('results'),
      this.all<FeedContinuityEvent>('continuityEvents'),
      this.all<TransportEventRecord>('transportEvents'),
    ]);
    return {
      ticks,
      payoutSnapshots: storedPayouts.map((value) => value.payout),
      candles: storedCandles.map((value) => value.candle),
      decisions,
      entryResolutions: entries,
      decisionSignalLinks: links,
      signals,
      results,
      continuityEvents,
      transportEvents,
    };
  }

  private async appendImmutable<T>(storeName: StoreName, key: IDBValidKey, value: T): Promise<void> {
    const transaction = this.db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const existing = await requestResult(store.get(key));
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(value)) {
        transaction.abort();
        throw new Error(`Append-only conflict in ${storeName}`);
      }
      await transactionDone(transaction);
      return;
    }
    store.add(value);
    await transactionDone(transaction);
  }

  private async all<T>(storeName: StoreName): Promise<T[]> {
    const transaction = this.db.transaction(storeName, 'readonly');
    const values = await requestResult(transaction.objectStore(storeName).getAll());
    await transactionDone(transaction);
    return values as T[];
  }
}
