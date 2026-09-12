import { Timeframe } from '../models/types';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M1:  60_000,
  M5:  300_000,
  M15: 900_000,
};

/**
 * Retorna o timestamp de início do intervalo de candle que contém `timestampMs`.
 * Alinhado ao epoch UTC — sem arredondamento por timezone local.
 */
export function alignToCandleStart(timestampMs: number, timeframe: Timeframe): number {
  const periodMs = TIMEFRAME_MS[timeframe];
  return Math.floor(timestampMs / periodMs) * periodMs;
}

/**
 * Retorna o timestamp de fim (exclusivo) do intervalo de candle.
 */
export function alignToCandleEnd(timestampMs: number, timeframe: Timeframe): number {
  return alignToCandleStart(timestampMs, timeframe) + TIMEFRAME_MS[timeframe];
}

/**
 * Retorna true se dois timestamps pertencem ao mesmo intervalo de candle.
 */
export function sameInterval(tsA: number, tsB: number, timeframe: Timeframe): boolean {
  return alignToCandleStart(tsA, timeframe) === alignToCandleStart(tsB, timeframe);
}

/**
 * Calcula quantos intervalos de candle existem entre dois timestamps (sem sobreposição).
 * Usado para detecção de gap.
 */
export function intervalsBetween(fromMs: number, toMs: number, timeframe: Timeframe): number {
  const periodMs = TIMEFRAME_MS[timeframe];
  const startA = alignToCandleStart(fromMs, timeframe);
  const startB = alignToCandleStart(toMs, timeframe);
  return Math.max(0, (startB - startA) / periodMs - 1);
}
