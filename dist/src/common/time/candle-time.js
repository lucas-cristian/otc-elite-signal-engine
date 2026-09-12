export const TIMEFRAME_MS = {
    '5s': 5_000,
    '10s': 10_000,
    '15s': 15_000,
    '30s': 30_000,
    '60s': 60_000,
};
export function alignToCandleStart(timestampMs, timeframe) {
    const size = TIMEFRAME_MS[timeframe];
    return Math.floor(timestampMs / size) * size;
}
export function alignToCandleEnd(startTimestampMs, timeframe) {
    return startTimestampMs + TIMEFRAME_MS[timeframe];
}
