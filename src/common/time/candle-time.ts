import type { Timeframe } from '../models/types.js';

export const TIMEFRAME_MS: Readonly<Record<Timeframe, number>> = {
  '5s': 5_000,
  '10s': 10_000,
  '15s': 15_000,
  '30s': 30_000,
  '60s': 60_000,
};

export function alignToCandleStart(timestampMs: number, timeframe: Timeframe): number {
  const size = TIMEFRAME_MS[timeframe];
  return Math.floor(timestampMs / size) * size;
}

export function alignToCandleEnd(startTimestampMs: number, timeframe: Timeframe): number {
  return startTimestampMs + TIMEFRAME_MS[timeframe];
}
