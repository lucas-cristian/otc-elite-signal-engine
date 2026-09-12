import type { DecisionRecord, SignalRecord } from '../../common/models/journal-types.js';
import type { JournalRepository } from './journal-repository.js';

export interface RecoveryState {
  pendingEntries: DecisionRecord[];
  pendingResults: SignalRecord[];
}

export class RecoveryService {
  public constructor(private readonly journal: JournalRepository) {}

  public async derive(): Promise<RecoveryState> {
    const snapshot = await this.journal.snapshot();
    const resolvedDecisionIds = new Set(snapshot.entryResolutions.map((entry) => entry.decisionId));
    const resultSignalIds = new Set(snapshot.results.map((result) => result.signalId));
    return {
      pendingEntries: snapshot.decisions.filter(
        (decision) => (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT') && !resolvedDecisionIds.has(decision.decisionId),
      ),
      pendingResults: snapshot.signals.filter((signal) => !resultSignalIds.has(signal.signalId)),
    };
  }
}
