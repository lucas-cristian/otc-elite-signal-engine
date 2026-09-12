export class RecoveryService {
    journal;
    constructor(journal) {
        this.journal = journal;
    }
    async derive() {
        const snapshot = await this.journal.snapshot();
        const resolvedDecisionIds = new Set(snapshot.entryResolutions.map((entry) => entry.decisionId));
        const resultSignalIds = new Set(snapshot.results.map((result) => result.signalId));
        const latestTick = snapshot.ticks.reduce((latest, tick) => latest === null || tick.receivedAtEpochMs > latest.receivedAtEpochMs ? tick : latest, null);
        const latestTicks = new Map();
        for (const tick of snapshot.ticks) {
            const key = `${tick.marketSourceIdentity.canonicalAssetId}::${tick.marketSourceIdentity.feedId}`;
            const current = latestTicks.get(key);
            if (!current || tick.receivedAtEpochMs > current.receivedAtEpochMs)
                latestTicks.set(key, tick);
        }
        const payouts = new Map();
        for (const payout of snapshot.payoutSnapshots) {
            const key = `${payout.canonicalAssetId}:${payout.feedId ?? 'UNKNOWN'}`;
            const current = payouts.get(key);
            if (!current || payout.capturedAt > current.capturedAt)
                payouts.set(key, payout);
        }
        return {
            pendingEntries: snapshot.decisions.filter((decision) => (decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT') && !resolvedDecisionIds.has(decision.decisionId)),
            pendingResults: snapshot.signals.filter((signal) => !resultSignalIds.has(signal.signalId)),
            latestTick,
            latestTicksByAssetFeed: [...latestTicks.values()],
            latestPayoutSnapshots: [...payouts.values()],
        };
    }
}
