import { canonicalJson } from '../../common/hashing/canonical-hash.js';
export class MemoryJournal {
    ticks = new Map();
    payouts = new Map();
    candles = new Map();
    decisions = new Map();
    entries = new Map();
    links = new Map();
    signals = new Map();
    results = new Map();
    async appendTick(value) { this.append(this.ticks, value.tickId, value); }
    async appendPayoutSnapshot(value) { this.append(this.payouts, `${value.canonicalAssetId}:${value.feedId ?? 'UNKNOWN'}:${value.expirationSeconds ?? 'ANY'}:${value.capturedAt}`, value); }
    async appendCandle(value) { this.append(this.candles, this.candleKey(value), value); }
    async appendDecision(value) { this.append(this.decisions, value.decisionId, value); }
    async appendEntryResolution(value) { this.append(this.entries, value.decisionId, value); }
    async appendDecisionSignalLink(value) { this.append(this.links, value.decisionId, value); }
    async appendSignal(value) { this.append(this.signals, value.signalId, value); }
    async appendResult(value) { this.append(this.results, value.signalId, value); }
    async snapshot() {
        return {
            ticks: [...this.ticks.values()],
            payoutSnapshots: [...this.payouts.values()],
            candles: [...this.candles.values()],
            decisions: [...this.decisions.values()],
            entryResolutions: [...this.entries.values()],
            decisionSignalLinks: [...this.links.values()],
            signals: [...this.signals.values()],
            results: [...this.results.values()],
        };
    }
    append(map, key, value) {
        const existing = map.get(key);
        if (existing && canonicalJson(existing) !== canonicalJson(value))
            throw new Error(`Append-only conflict for ${key}`);
        if (!existing)
            map.set(key, value);
    }
    candleKey(candle) {
        return `${candle.canonicalAssetId}:${candle.timeframe}:${candle.startTimestamp}:${candle.lifecycle}`;
    }
}
