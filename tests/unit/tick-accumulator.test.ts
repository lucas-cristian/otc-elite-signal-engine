import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TickAccumulator } from '../../src/service-worker/engine/tick-accumulator';
import { Tick, Candle } from '../../src/common/models/types';

const BASE = 1704067200000;

function makeTick(price: number, offsetMs: number, asset = 'EURUSD'): Tick {
  return {
    tickId: `t_${offsetMs}`,
    tickSchemaVersion: '1',
    marketSourceIdentity: {} as any,
    pageSessionId: 'sess',
    asset,
    price,
    eventTimestamp: BASE + offsetMs,
    timestampBasis: 'LOCAL_RECEIVED',
  } as unknown as Tick;
}

afterEach(() => vi.restoreAllMocks());

describe('TickAccumulator', () => {
  it('routes ticks to all configured timeframes', () => {
    const candles: Candle[] = [];
    const acc = new TickAccumulator('EURUSD', {
      timeframes: ['M1', 'M5'],
      staleThresholdMs: 30_000,
      timestampBasis: 'LOCAL_RECEIVED',
      onCandle: c => candles.push(c),
      onDataUnavailable: vi.fn(),
    });

    acc.ingestTick(makeTick(1.10, 5_000));
    acc.ingestTick(makeTick(1.11, 65_000)); // fecha M1

    // Deve ter fechado 1 candle M1 (M5 ainda está FORMING)
    expect(candles.filter(c => c.timeframe === 'M1')).toHaveLength(1);
    expect(candles.filter(c => c.timeframe === 'M5')).toHaveLength(0);
  });

  it('rejects ticks with invalid price (0 or negative)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onCandle = vi.fn();
    const acc = new TickAccumulator('EURUSD', {
      timeframes: ['M1'],
      staleThresholdMs: 30_000,
      timestampBasis: 'LOCAL_RECEIVED',
      onCandle,
      onDataUnavailable: vi.fn(),
    });

    acc.ingestTick(makeTick(0, 5_000));
    acc.ingestTick(makeTick(-1, 10_000));

    expect(warn).toHaveBeenCalledTimes(2);
    expect(onCandle).not.toHaveBeenCalled();
  });

  it('triggers onDataUnavailable after stale threshold', async () => {
    vi.useFakeTimers();
    const onDataUnavailable = vi.fn();

    const acc = new TickAccumulator('EURUSD', {
      timeframes: ['M1'],
      staleThresholdMs: 5_000,
      timestampBasis: 'LOCAL_RECEIVED',
      onCandle: vi.fn(),
      onDataUnavailable,
    });

    acc.ingestTick(makeTick(1.10, 5_000));

    vi.advanceTimersByTime(5_001);

    expect(onDataUnavailable).toHaveBeenCalledWith('EURUSD', 'FEED_STALE');
    vi.useRealTimers();
  });

  it('resets stale timer on new tick', async () => {
    vi.useFakeTimers();
    const onDataUnavailable = vi.fn();

    const acc = new TickAccumulator('EURUSD', {
      timeframes: ['M1'],
      staleThresholdMs: 5_000,
      timestampBasis: 'LOCAL_RECEIVED',
      onCandle: vi.fn(),
      onDataUnavailable,
    });

    acc.ingestTick(makeTick(1.10, 0));
    vi.advanceTimersByTime(4_000);
    acc.ingestTick(makeTick(1.11, 4_000)); // reinicia timer

    vi.advanceTimersByTime(4_000); // ainda dentro do novo timeout
    expect(onDataUnavailable).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000); // agora estoura
    expect(onDataUnavailable).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
