export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: readonly number[]): number | null {
  const avg = mean(values);
  if (avg === null || values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function ema(values: readonly number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const seed = mean(values.slice(0, period));
  if (seed === null) return null;
  const alpha = 2 / (period + 1);
  let current = seed;
  for (let index = period; index < values.length; index++) current = (values[index] ?? current) * alpha + current * (1 - alpha);
  return current;
}

export function rsiWilder(values: readonly number[], period: number): number | null {
  if (period <= 0 || values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const delta = (values[index] ?? 0) - (values[index - 1] ?? 0);
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let index = period + 1; index < values.length; index++) {
    const delta = (values[index] ?? 0) - (values[index - 1] ?? 0);
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(highs: readonly number[], lows: readonly number[], closes: readonly number[], period: number): number | null {
  if (period <= 0 || highs.length !== lows.length || lows.length !== closes.length || closes.length < period + 1) return null;
  const tr: number[] = [];
  for (let index = 1; index < closes.length; index++) {
    const high = highs[index];
    const low = lows[index];
    const prevClose = closes[index - 1];
    if (high === undefined || low === undefined || prevClose === undefined) return null;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let current = mean(tr.slice(0, period));
  if (current === null) return null;
  for (let index = period; index < tr.length; index++) current = (current * (period - 1) + (tr[index] ?? current)) / period;
  return current;
}

export function stochastic(highs: readonly number[], lows: readonly number[], closes: readonly number[], period: number): number | null {
  if (period <= 0 || closes.length < period || highs.length !== closes.length || lows.length !== closes.length) return null;
  const hs = highs.slice(-period);
  const ls = lows.slice(-period);
  const highest = Math.max(...hs);
  const lowest = Math.min(...ls);
  const close = closes[closes.length - 1];
  if (close === undefined) return null;
  if (highest === lowest) return 50;
  return ((close - lowest) / (highest - lowest)) * 100;
}

export function bollingerZ(values: readonly number[], period: number): number | null {
  if (period <= 1 || values.length < period) return null;
  const window = values.slice(-period);
  const avg = mean(window);
  const sd = standardDeviation(window);
  const latest = window[window.length - 1];
  if (avg === null || sd === null || latest === undefined) return null;
  return sd === 0 ? 0 : (latest - avg) / sd;
}
