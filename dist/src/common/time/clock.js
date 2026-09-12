export class LiveClock {
    nowEpochMs() { return Date.now(); }
    nowMonotonicMs() { return performance.now(); }
}
export class ReplayClock {
    epochMs;
    monotonicMs;
    constructor(epochMs, monotonicMs = 0) {
        this.epochMs = epochMs;
        this.monotonicMs = monotonicMs;
    }
    nowEpochMs() { return this.epochMs; }
    nowMonotonicMs() { return this.monotonicMs; }
    advanceTo(epochMs) {
        if (epochMs < this.epochMs)
            throw new RangeError('Replay clock cannot move backward');
        this.monotonicMs += epochMs - this.epochMs;
        this.epochMs = epochMs;
    }
}
