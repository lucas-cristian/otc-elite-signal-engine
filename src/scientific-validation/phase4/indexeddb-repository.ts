import { canonicalJson } from '../../common/hashing/canonical-hash.js';
import type {
  Phase4AuditEvent,
  Phase4DatasetImportRecord,
  Phase4EpisodeRecord,
  Phase4Evaluation,
  Phase4ExclusionRecord,
  Phase4Experiment,
} from './types.js';
import type { Phase4Repository, Phase4Snapshot } from './repository.js';

type StoreName = 'experiments' | 'datasets' | 'episodes' | 'exclusions' | 'auditEvents' | 'evaluations';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Phase 4 IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Phase 4 IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Phase 4 IndexedDB transaction aborted'));
  });
}

export function openPhase4Database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('otc-elite-phase4-validation', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('experiments', { keyPath: 'experimentId' });
      db.createObjectStore('datasets', { keyPath: 'key' });
      db.createObjectStore('episodes', { keyPath: 'key' });
      db.createObjectStore('exclusions', { keyPath: 'exclusionId' });
      db.createObjectStore('auditEvents', { keyPath: 'auditEventId' });
      db.createObjectStore('evaluations', { keyPath: 'experimentId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open Phase 4 IndexedDB'));
  });
}

export class IndexedDbPhase4Repository implements Phase4Repository {
  public constructor(private readonly db: IDBDatabase) {}

  public appendExperiment(value: Phase4Experiment): Promise<void> { return this.appendImmutable('experiments', value.experimentId, value); }
  public appendDataset(value: Phase4DatasetImportRecord): Promise<void> { return this.appendImmutable('datasets', value.key, value); }
  public appendEpisode(value: Phase4EpisodeRecord): Promise<void> { return this.appendImmutable('episodes', value.key, value); }
  public appendExclusion(value: Phase4ExclusionRecord): Promise<void> { return this.appendImmutable('exclusions', value.exclusionId, value); }
  public appendAuditEvent(value: Phase4AuditEvent): Promise<void> { return this.appendImmutable('auditEvents', value.auditEventId, value); }
  public appendEvaluation(value: Phase4Evaluation): Promise<void> { return this.appendImmutable('evaluations', value.experimentId, value); }

  public async snapshot(): Promise<Phase4Snapshot> {
    const [experiments, datasets, episodes, exclusions, auditEvents, evaluations] = await Promise.all([
      this.all<Phase4Experiment>('experiments'),
      this.all<Phase4DatasetImportRecord>('datasets'),
      this.all<Phase4EpisodeRecord>('episodes'),
      this.all<Phase4ExclusionRecord>('exclusions'),
      this.all<Phase4AuditEvent>('auditEvents'),
      this.all<Phase4Evaluation>('evaluations'),
    ]);
    return { experiments, datasets, episodes, exclusions, auditEvents, evaluations };
  }

  private async appendImmutable<T>(storeName: StoreName, key: IDBValidKey, value: T): Promise<void> {
    const transaction = this.db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const existing = await requestResult(store.get(key));
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(value)) {
        transaction.abort();
        throw new Error(`Phase 4 append-only conflict in ${storeName}`);
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
