import type { DecisionRecord, SignalRecord } from '../../common/models/journal-types.js';
import type { PayoutSnapshot, Tick } from '../../common/models/types.js';
import type { JournalRepository } from './journal-repository.js';

export interface RecoveryState {
  pendingEntries: DecisionRecord[];
  pendingResults: SignalRecord[];
  latestTick: Tick | null;
  latestPayoutSnapshots: PayoutSnapshot[];
}

export class RecoveryService {
  public constructor(private readonly journal: JournalRepository) {}

  public async derive(): Promise<RecoveryState> {
    const snapshot = await this.journal.snapshot();
    const resolvedDecisionIds = new Set(snapshot.entryResolutions.map((entry) => entry.decisionId));
    const resultSignalIds = new Set(snapshot.results.map((result) => result.signalId));
    const latestTick = snapshot.ticks.reduce(
      (latest, tick) => latest === null || tick.receivedAtEpochMs > latest.receivedAtEpochMs ? tick : latest,
      null as Tick | null,
    );
    const payouts = new Map<string, PayoutSnapshot>();
    for (const payout of snapshot.payoutSnapshots) {
      const key = `${payout.canonicalAssetId}:${payout.feedId ?? 'UNKNOWN'}`;
      const current = payouts.get(key);
      if (!current || payout.capturedAt > current.capturedAt) payouts.set(key, payout);
    }
    return {
      pendingEntries: snapshot.decisions.filter(
        (decision) => (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT') && !resolvedDecisionIds.has(decision.decisionId),
      ),
      pendingResults: snapshot.signals.filter((signal) => !resultSignalIds.has(signal.signalId)),
      latestTick,
      latestPayoutSnapshots: [...payouts.values()],
    };
  }
}
