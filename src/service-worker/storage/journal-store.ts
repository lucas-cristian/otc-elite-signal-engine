import {
  DecisionRecord,
  EntryResolutionRecord,
  SignalRecord,
  ResultRecord,
} from '../../common/models/journal-types';
import { STORE, StoreName } from './idb-schema';

/**
 * Erro lançado quando se tenta inserir um registro com ID já existente.
 * Garante o contrato de imutabilidade do Journal.
 */
export class DuplicateJournalEntryError extends Error {
  constructor(store: StoreName, id: string) {
    super(`[JournalStore] Duplicate entry rejected: store=${store} id=${id}`);
    this.name = 'DuplicateJournalEntryError';
  }
}

/**
 * Wrapper append-only sobre o IDB.
 *
 * CONTRATO:
 * - Nenhum método de update ou delete é exposto.
 * - Inserção duplicada (mesmo ID) lança DuplicateJournalEntryError.
 * - Toda operação é atômica via transaction.
 */
export class JournalStore {
  constructor(private readonly db: IDBDatabase) {}

  // ── Append methods ────────────────────────────────────────────────────────

  async appendDecision(record: DecisionRecord): Promise<void> {
    return this.appendRecord(STORE.DECISIONS, record.decisionId, record);
  }

  async appendEntryResolution(record: EntryResolutionRecord): Promise<void> {
    return this.appendRecord(STORE.ENTRY_RESOLUTIONS, record.entryResolutionId, record);
  }

  async appendSignal(record: SignalRecord): Promise<void> {
    return this.appendRecord(STORE.SIGNALS, record.signalId, record);
  }

  async appendResult(record: ResultRecord): Promise<void> {
    return this.appendRecord(STORE.RESULTS, record.resultId, record);
  }

  // ── Core append implementation ────────────────────────────────────────────

  private appendRecord(
    storeName: StoreName,
    id: string,
    record: unknown,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      // Verifica existência antes de inserir (imutabilidade)
      const checkReq = store.getKey(id);

      checkReq.onsuccess = () => {
        if (checkReq.result !== undefined) {
          tx.abort();
          reject(new DuplicateJournalEntryError(storeName, id));
          return;
        }

        const addReq = store.add(record);
        addReq.onerror = () => reject(addReq.error);
      };

      checkReq.onerror = () => reject(checkReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => {
        // Só rejeita se ainda não foi rejeitado via DuplicateJournalEntryError
        // (o reject acima já foi chamado nesse caso)
      };
    });
  }
}
