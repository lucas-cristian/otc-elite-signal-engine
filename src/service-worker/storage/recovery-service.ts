import type { DecisionRecord, SignalRecord } from '../../common/models/journal-types.js';
import type { PayoutSnapshot, Tick } from '../../common/models/types.js';
import type { JournalRepository } from './journal-repository.js';

export interface RecoveredAssetFeedState {
  tick: Tick;
  feedEpochId: string;
}

export interface RecoveryState {
  pendingEntries: DecisionRecord[];
  pendingResults: SignalRecord[];
  latestTick: Tick | null;
  latestAssetFeedStates: RecoveredAssetFeedState[];
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
    const latestTicks = new Map<string, Tick>();
    for (const tick of snapshot.ticks) {
      const key = `${tick.marketSourceIdentity.canonicalAssetId}::${tick.marketSourceIdentity.feedId}`;
      const current = latestTicks.get(key);
      if (!current || tick.receivedAtEpochMs > current.receivedAtEpochMs) latestTicks.set(key, tick);
    }
    const latestOpenEpoch = new Map<string, string>();
    const endedEpochs = new Set<string>();
    for (const event of [...snapshot.continuityEvents].sort((a, b) => a.occurredAt - b.occurredAt)) {
      const key = `${event.canonicalAssetId}::${event.feedId}`;
      if (event.eventType === 'EPOCH_ENDED') {
        endedEpochs.add(event.feedEpochId);
        if (latestOpenEpoch.get(key) === event.feedEpochId) latestOpenEpoch.delete(key);
      } else if (event.eventType === 'EPOCH_STARTED' && !endedEpochs.has(event.feedEpochId)) {
        latestOpenEpoch.set(key, event.feedEpochId);
      }
    }
    const payouts = new Map<string, PayoutSnapshot>();
    for (const payout of snapshot.payoutSnapshots) {
      const key = `${payout.canonicalAssetId}:${payout.feedId ?? 'UNKNOWN'}`;
      const current = payouts.get(key);
      if (!current || payout.capturedAt > current.capturedAt) payouts.set(key, payout);
    }
    const latestAssetFeedStates: RecoveredAssetFeedState[] = [];
    for (const [key, tick] of latestTicks) {
      const [canonicalAssetId, feedId] = key.split('::');
      const fallbackDecision = snapshot.decisions
        .filter((decision) => decision.canonicalAssetId === canonicalAssetId && decision.sourceFeedId === feedId)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      const fallbackSignal = snapshot.signals
        .filter((signal) => signal.canonicalAssetId === canonicalAssetId && signal.entryMarketSourceIdentity.feedId === feedId)
        .sort((a, b) => b.signalCreatedAt - a.signalCreatedAt)[0];
      const feedEpochId = latestOpenEpoch.get(key) ?? fallbackSignal?.feedEpochId ?? fallbackDecision?.feedEpochId ?? `recovered-${tick.tickId}`;
      latestAssetFeedStates.push({ tick, feedEpochId });
    }
    return {
      pendingEntries: snapshot.decisions.filter(
        (decision) => (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT') && !resolvedDecisionIds.has(decision.decisionId),
      ),
      pendingResults: snapshot.signals.filter((signal) => !resultSignalIds.has(signal.signalId)),
      latestTick,
      latestAssetFeedStates,
      latestPayoutSnapshots: [...payouts.values()],
    };
  }
}
