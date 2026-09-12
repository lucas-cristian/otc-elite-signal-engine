import type { Candle, Tick, Timeframe } from '../../common/models/types.js';
import { alignToCandleEnd, alignToCandleStart, TIMEFRAME_MS } from '../../common/time/candle-time.js';

interface CandleState {
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
  timestampBasis: Tick['timestampBasis'];
  gapAffected: boolean;
}

export type CandleEmitter = (candle: Candle) => void;

export class CandleBuilder {
  private state: CandleState | null = null;
  private firstCandle = true;

  public constructor(
    private readonly canonicalAssetId: string,
    private readonly feedId: string,
    private readonly feedEpochId: string,
    private readonly timeframe: Timeframe,
    private readonly emitter: CandleEmitter,
    private readonly firstCandleGapAffected = false,
  ) {}

  public ingest(tick: Tick): void {
    const bucket = alignToCandleStart(tick.eventTimestampEpochMs, this.timeframe);
    if (!this.state) {
      this.state = this.open(bucket, tick, this.firstCandle && this.firstCandleGapAffected);
      this.firstCandle = false;
      return;
    }
    if (bucket < this.state.start) return;
    if (bucket === this.state.start) {
      this.state.high = Math.max(this.state.high, tick.price);
      this.state.low = Math.min(this.state.low, tick.price);
      this.state.close = tick.price;
      this.state.tickCount += 1;
      if (tick.timestampBasis === 'LOCAL_RECEIPT') this.state.timestampBasis = 'LOCAL_RECEIPT';
      return;
    }
    const previous = this.state;
    this.emitClosed(previous);
    const size = TIMEFRAME_MS[this.timeframe];
    const missing = Math.max(0, Math.floor((bucket - previous.start) / size) - 1);
    for (let index = 1; index <= missing; index++) this.emitEmpty(previous.start + index * size);
    this.state = this.open(bucket, tick, missing > 0);
  }

  public advanceClock(epochMs: number): void {
    if (!this.state) return;
    if (epochMs < alignToCandleEnd(this.state.start, this.timeframe)) return;
    const closed = this.state;
    this.state = null;
    this.emitClosed(closed);
  }

  public partial(): Candle | null {
    return this.state ? this.toCandle(this.state, 'FORMING') : null;
  }

  private open(start: number, tick: Tick, gapAffected: boolean): CandleState {
    return {
      start,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      tickCount: 1,
      timestampBasis: tick.timestampBasis,
      gapAffected,
    };
  }

  private emitClosed(state: CandleState): void {
    this.emitter(this.toCandle(state, 'CLOSED'));
  }

  private emitEmpty(start: number): void {
    this.emitter({
      candleSchemaVersion: '4',
      canonicalAssetId: this.canonicalAssetId,
      feedId: this.feedId,
      feedEpochId: this.feedEpochId,
      timeframe: this.timeframe,
      startTimestamp: start,
      endTimestamp: alignToCandleEnd(start, this.timeframe),
      lifecycle: 'EMPTY_INTERVAL',
      quality: 'GAP_AFFECTED',
      open: null,
      high: null,
      low: null,
      close: null,
      tickCount: 0,
      timestampBasis: 'LOCAL_RECEIPT',
    });
  }

  private toCandle(state: CandleState, lifecycle: Candle['lifecycle']): Candle {
    return {
      candleSchemaVersion: '4',
      canonicalAssetId: this.canonicalAssetId,
      feedId: this.feedId,
      feedEpochId: this.feedEpochId,
      timeframe: this.timeframe,
      startTimestamp: state.start,
      endTimestamp: alignToCandleEnd(state.start, this.timeframe),
      lifecycle,
      quality: state.gapAffected ? 'GAP_AFFECTED' : 'CLEAN',
      open: state.open,
      high: state.high,
      low: state.low,
      close: state.close,
      tickCount: state.tickCount,
      timestampBasis: state.timestampBasis,
    };
  }
}
