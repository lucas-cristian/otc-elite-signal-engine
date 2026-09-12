import { describe, it, expect } from 'vitest';
import { alignToCandleStart, alignToCandleEnd, sameInterval, intervalsBetween } from '../../src/common/time/candle-time';

// Referência: 2024-01-01 00:00:00 UTC = 1704067200000 ms
const BASE = 1704067200000;

describe('alignToCandleStart', () => {
  it('aligns M1 correctly', () => {
    const ts = BASE + 45_000; // 00:00:45
    expect(alignToCandleStart(ts, 'M1')).toBe(BASE); // 00:00:00
  });

  it('aligns M5 correctly', () => {
    const ts = BASE + 4 * 60_000 + 59_000; // 00:04:59
    expect(alignToCandleStart(ts, 'M5')).toBe(BASE); // 00:00:00
  });

  it('aligns to next M1 candle', () => {
    const ts = BASE + 60_000; // exato início do segundo minuto
    expect(alignToCandleStart(ts, 'M1')).toBe(BASE + 60_000);
  });
});

describe('alignToCandleEnd', () => {
  it('M1 end is start + 60s', () => {
    expect(alignToCandleEnd(BASE, 'M1')).toBe(BASE + 60_000);
  });
});

describe('sameInterval', () => {
  it('two timestamps in same M1 minute are same interval', () => {
    expect(sameInterval(BASE + 10_000, BASE + 59_000, 'M1')).toBe(true);
  });

  it('timestamps in different minutes are different intervals', () => {
    expect(sameInterval(BASE + 59_000, BASE + 61_000, 'M1')).toBe(false);
  });
});

describe('intervalsBetween', () => {
  it('returns 0 for adjacent candles', () => {
    // Candle A: [BASE, BASE+60s), Candle B: [BASE+60s, BASE+120s)
    expect(intervalsBetween(BASE + 30_000, BASE + 90_000, 'M1')).toBe(0);
  });

  it('returns 1 for one missing candle', () => {
    // Candle A: [BASE, BASE+60s), gap: [BASE+60s, BASE+120s), Candle B: [BASE+120s, BASE+180s)
    expect(intervalsBetween(BASE + 30_000, BASE + 150_000, 'M1')).toBe(1);
  });

  it('returns 2 for two missing candles', () => {
    expect(intervalsBetween(BASE + 30_000, BASE + 210_000, 'M1')).toBe(2);
  });

  it('returns 0 for same interval', () => {
    expect(intervalsBetween(BASE + 10_000, BASE + 50_000, 'M1')).toBe(0);
  });
});
