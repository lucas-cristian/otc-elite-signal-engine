import { alignToCandleEnd, alignToCandleStart, TIMEFRAME_MS } from '../../common/time/candle-time.js';
export class CandleBuilder {
    canonicalAssetId;
    timeframe;
    emitter;
    state = null;
    constructor(canonicalAssetId, timeframe, emitter) {
        this.canonicalAssetId = canonicalAssetId;
        this.timeframe = timeframe;
        this.emitter = emitter;
    }
    ingest(tick) {
        const bucket = alignToCandleStart(tick.eventTimestampEpochMs, this.timeframe);
        if (!this.state) {
            this.state = this.open(bucket, tick, false);
            return;
        }
        if (bucket < this.state.start)
            return;
        if (bucket === this.state.start) {
            this.state.high = Math.max(this.state.high, tick.price);
            this.state.low = Math.min(this.state.low, tick.price);
            this.state.close = tick.price;
            this.state.tickCount += 1;
            if (tick.timestampBasis === 'LOCAL_RECEIPT')
                this.state.timestampBasis = 'LOCAL_RECEIPT';
            return;
        }
        const previous = this.state;
        this.emitClosed(previous);
        const size = TIMEFRAME_MS[this.timeframe];
        const missing = Math.max(0, Math.floor((bucket - previous.start) / size) - 1);
        for (let index = 1; index <= missing; index++)
            this.emitEmpty(previous.start + index * size);
        this.state = this.open(bucket, tick, missing > 0);
    }
    advanceClock(epochMs) {
        if (!this.state)
            return;
        if (epochMs < alignToCandleEnd(this.state.start, this.timeframe))
            return;
        const closed = this.state;
        this.state = null;
        this.emitClosed(closed);
    }
    partial() {
        return this.state ? this.toCandle(this.state, 'FORMING') : null;
    }
    open(start, tick, gapAffected) {
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
    emitClosed(state) {
        this.emitter(this.toCandle(state, 'CLOSED'));
    }
    emitEmpty(start) {
        this.emitter({
            candleSchemaVersion: '2',
            canonicalAssetId: this.canonicalAssetId,
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
    toCandle(state, lifecycle) {
        return {
            candleSchemaVersion: '2',
            canonicalAssetId: this.canonicalAssetId,
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
