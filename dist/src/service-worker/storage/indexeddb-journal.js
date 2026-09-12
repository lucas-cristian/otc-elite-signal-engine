import { canonicalJson } from '../../common/hashing/canonical-hash.js';
function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}
function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}
export async function openJournalDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('otc-elite-signal-engine', 6);
        request.onupgradeneeded = () => {
            const db = request.result;
            for (const name of Array.from(db.objectStoreNames))
                db.deleteObjectStore(name);
            db.createObjectStore('ticks', { keyPath: 'tickId' });
            db.createObjectStore('payoutSnapshots', { keyPath: 'key' });
            db.createObjectStore('candles', { keyPath: 'key' });
            db.createObjectStore('decisions', { keyPath: 'decisionId' });
            db.createObjectStore('entryResolutions', { keyPath: 'decisionId' });
            db.createObjectStore('decisionSignalLinks', { keyPath: 'decisionId' });
            db.createObjectStore('signals', { keyPath: 'signalId' });
            db.createObjectStore('results', { keyPath: 'signalId' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
    });
}
export class IndexedDbJournal {
    db;
    constructor(db) {
        this.db = db;
    }
    appendTick(value) { return this.appendImmutable('ticks', value.tickId, value); }
    appendPayoutSnapshot(value) { const key = `${value.canonicalAssetId}:${value.feedId ?? 'UNKNOWN'}:${value.expirationSeconds ?? 'ANY'}:${value.capturedAt}`; return this.appendImmutable('payoutSnapshots', key, { key, payout: value }); }
    appendCandle(value) {
        const key = `${value.canonicalAssetId}:${value.feedId}:${value.timeframe}:${value.startTimestamp}:${value.lifecycle}`;
        return this.appendImmutable('candles', key, { key, candle: value });
    }
    appendDecision(value) { return this.appendImmutable('decisions', value.decisionId, value); }
    appendEntryResolution(value) { return this.appendImmutable('entryResolutions', value.decisionId, value); }
    appendDecisionSignalLink(value) { return this.appendImmutable('decisionSignalLinks', value.decisionId, value); }
    appendSignal(value) { return this.appendImmutable('signals', value.signalId, value); }
    appendResult(value) { return this.appendImmutable('results', value.signalId, value); }
    async snapshot() {
        const [ticks, storedPayouts, storedCandles, decisions, entries, links, signals, results] = await Promise.all([
            this.all('ticks'),
            this.all('payoutSnapshots'),
            this.all('candles'),
            this.all('decisions'),
            this.all('entryResolutions'),
            this.all('decisionSignalLinks'),
            this.all('signals'),
            this.all('results'),
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
        };
    }
    async appendImmutable(storeName, key, value) {
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
    async all(storeName) {
        const transaction = this.db.transaction(storeName, 'readonly');
        const values = await requestResult(transaction.objectStore(storeName).getAll());
        await transactionDone(transaction);
        return values;
    }
}
