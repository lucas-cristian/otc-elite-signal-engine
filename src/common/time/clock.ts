export interface Clock {
  nowEpochMs(): number;
  nowMonotonicMs(): number;
}

export class LiveClock implements Clock {
  public nowEpochMs(): number { return Date.now(); }
  public nowMonotonicMs(): number { return performance.now(); }
}

export class ReplayClock implements Clock {
  public constructor(private epochMs: number, private monotonicMs = 0) {}
  public nowEpochMs(): number { return this.epochMs; }
  public nowMonotonicMs(): number { return this.monotonicMs; }
  public advanceTo(epochMs: number): void {
    if (epochMs < this.epochMs) throw new RangeError('Replay clock cannot move backward');
    this.monotonicMs += epochMs - this.epochMs;
    this.epochMs = epochMs;
  }
}
