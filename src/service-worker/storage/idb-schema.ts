/**
 * Schema do IDB — objeto único de verdade para versioning e object stores.
 *
 * REGRAS DE IMUTABILIDADE:
 * - Nenhuma store pode ter `autoIncrement: true` — IDs são gerados externamente via canonicalEntityHash.
 * - Nenhum método de update ou delete é exposto.
 * - Toda inserção com chave duplicada é REJEITADA (não silenciosa).
 */

export const DB_NAME = 'otc_elite_journal';
export const DB_VERSION = 1;

export const STORE = {
  DECISIONS:         'decisions',
  ENTRY_RESOLUTIONS: 'entry_resolutions',
  SIGNALS:           'signals',
  RESULTS:           'results',
} as const;

export type StoreName = typeof STORE[keyof typeof STORE];

export function openJournalDB(
  idbFactory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idbFactory.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // ── decisions ──────────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains(STORE.DECISIONS)) {
        const store = db.createObjectStore(STORE.DECISIONS, {
          keyPath: 'decisionId',
        });
        store.createIndex('by_asset',       'asset',              { unique: false });
        store.createIndex('by_created_at',  'createdAt',          { unique: false });
        store.createIndex('by_eval_window', 'evaluationWindowId', { unique: false });
      }

      // ── entry_resolutions ──────────────────────────────────────────────────
      if (!db.objectStoreNames.contains(STORE.ENTRY_RESOLUTIONS)) {
        const store = db.createObjectStore(STORE.ENTRY_RESOLUTIONS, {
          keyPath: 'entryResolutionId',
        });
        store.createIndex('by_decision', 'decisionId', { unique: true }); // 1:1
      }

      // ── signals ───────────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains(STORE.SIGNALS)) {
        const store = db.createObjectStore(STORE.SIGNALS, {
          keyPath: 'signalId',
        });
        store.createIndex('by_asset',      'asset',              { unique: false });
        store.createIndex('by_decision',   'decisionId',         { unique: true }); // 1:1
        store.createIndex('by_created_at', 'signalCreatedAt',    { unique: false });
        store.createIndex('by_expiry',     'expectedExpiryTimestamp', { unique: false });
      }

      // ── results ───────────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains(STORE.RESULTS)) {
        const store = db.createObjectStore(STORE.RESULTS, {
          keyPath: 'resultId',
        });
        store.createIndex('by_signal',     'signalId',    { unique: true }); // 1:1
        store.createIndex('by_evaluated_at', 'evaluatedAt', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
    req.onblocked = () => reject(new Error('IDB upgrade blocked by another tab'));
  });
}
