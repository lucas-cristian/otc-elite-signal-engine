import {
  DecisionRecord,
  SignalRecord,
  ResultRecord,
  EntryResolutionRecord,
} from '../../common/models/journal-types';
import { STORE } from './idb-schema';

/**
 * Queries read-only sobre o Journal IDB.
 * Nunca expõe escrita — separação de responsabilidades de leitura e escrita.
 */
export class JournalReader {
  constructor(private readonly db: IDBDatabase) {}

  // ── Decision queries ──────────────────────────────────────────────────────

  getDecisionById(decisionId: string): Promise<DecisionRecord | undefined> {
    return this.getByKey<DecisionRecord>(STORE.DECISIONS, decisionId);
  }

  getDecisionsByAsset(asset: string, sinceMs: number): Promise<DecisionRecord[]> {
    return this.getRangeByIndex<DecisionRecord>(
      STORE.DECISIONS,
      'by_created_at',
      IDBKeyRange.lowerBound(sinceMs),
      (record) => record.asset === asset,
    );
  }

  // ── Signal queries ────────────────────────────────────────────────────────

  getSignalById(signalId: string): Promise<SignalRecord | undefined> {
    return this.getByKey<SignalRecord>(STORE.SIGNALS, signalId);
  }

  getSignalsByAsset(asset: string, sinceMs: number): Promise<SignalRecord[]> {
    return this.getRangeByIndex<SignalRecord>(
      STORE.SIGNALS,
      'by_created_at',
      IDBKeyRange.lowerBound(sinceMs),
      (record) => record.asset === asset,
    );
  }

  // ── Result queries ────────────────────────────────────────────────────────

  getResultBySignalId(signalId: string): Promise<ResultRecord | undefined> {
    return this.getByIndex<ResultRecord>(STORE.RESULTS, 'by_signal', signalId);
  }

  /**
   * Retorna signals cujo expectedExpiryTimestamp já passou mas ainda não têm resultado.
   */
  async listPendingResults(nowMs: number): Promise<SignalRecord[]> {
    const expiredSignals = await this.getRangeByIndex<SignalRecord>(
      STORE.SIGNALS,
      'by_expiry',
      IDBKeyRange.upperBound(nowMs),
    );

    // Filtra apenas os que ainda não têm resultado
    const pending: SignalRecord[] = [];
    for (const signal of expiredSignals) {
      const result = await this.getResultBySignalId(signal.signalId);
      if (!result) {
        pending.push(signal);
      }
    }
    return pending;
  }

  // ── Entry Resolution queries ──────────────────────────────────────────────

  getEntryResolutionByDecisionId(decisionId: string): Promise<EntryResolutionRecord | undefined> {
    return this.getByIndex<EntryResolutionRecord>(
      STORE.ENTRY_RESOLUTIONS,
      'by_decision',
      decisionId,
    );
  }

  // ── Generic helpers ───────────────────────────────────────────────────────

  private getByKey<T>(storeName: string, key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror   = () => reject(req.error);
    });
  }

  private getByIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).index(indexName).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror   = () => reject(req.error);
    });
  }

  private getRangeByIndex<T>(
    storeName: string,
    indexName: string,
    range: IDBKeyRange,
    filter?: (record: T) => boolean,
  ): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).index(indexName).getAll(range);
      req.onsuccess = () => {
        let results = req.result as T[];
        if (filter) results = results.filter(filter);
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }
}
