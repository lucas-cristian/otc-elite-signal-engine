import { atr, bollingerZ, ema, mean, rsiWilder, standardDeviation, stochastic } from './indicators.js';
function normalized(value, scale) {
    if (scale === null || scale === 0)
        return null;
    return value / scale;
}
function closesOf(candles) {
    return candles.flatMap((candle) => candle.close === null ? [] : [candle.close]);
}
function highsOf(candles) {
    return candles.flatMap((candle) => candle.high === null ? [] : [candle.high]);
}
function lowsOf(candles) {
    return candles.flatMap((candle) => candle.low === null ? [] : [candle.low]);
}
function tickImbalance(ticks) {
    if (ticks.length < 2)
        return null;
    let up = 0;
    let down = 0;
    for (let index = 1; index < ticks.length; index++) {
        const previous = ticks[index - 1];
        const current = ticks[index];
        if (!previous || !current)
            continue;
        if (current.price > previous.price)
            up += 1;
        else if (current.price < previous.price)
            down += 1;
    }
    const total = up + down;
    return total === 0 ? 0 : (up - down) / total;
}
function directionalSequence(candles) {
    if (candles.length === 0)
        return null;
    let sum = 0;
    for (const candle of candles) {
        if (candle.open === null || candle.close === null)
            continue;
        sum += Math.sign(candle.close - candle.open);
    }
    return sum / candles.length;
}
export class FeatureEngine {
    compute(input) {
        const candles = input.candles.filter((candle) => candle.lifecycle === 'CLOSED' && candle.endTimestamp <= input.cutoffTimestamp && candle.close !== null);
        const ticks = input.ticks.filter((tick) => tick.eventTimestampEpochMs < input.cutoffTimestamp && tick.integrity === 'VALID');
        const closes = closesOf(candles);
        const highs = highsOf(candles);
        const lows = lowsOf(candles);
        const latest = candles[candles.length - 1];
        const returns = closes.slice(1).map((value, index) => {
            const previous = closes[index];
            return previous === undefined || previous === 0 ? 0 : (value - previous) / previous;
        });
        const volatility = standardDeviation(returns.slice(-10));
        const latestClose = closes[closes.length - 1];
        const previousClose = closes[closes.length - 2];
        const threeBack = closes[closes.length - 4];
        const momentum1 = latestClose !== undefined && previousClose !== undefined ? latestClose - previousClose : null;
        const momentum3 = latestClose !== undefined && threeBack !== undefined ? latestClose - threeBack : null;
        const velocity = momentum1;
        const priorVelocity = previousClose !== undefined && threeBack !== undefined ? (previousClose - threeBack) / 2 : null;
        const acceleration = velocity !== null && priorVelocity !== null ? velocity - priorVelocity : null;
        const range = latest && latest.high !== null && latest.low !== null ? latest.high - latest.low : null;
        const body = latest && latest.open !== null && latest.close !== null ? Math.abs(latest.close - latest.open) : null;
        const upperWick = latest && latest.high !== null && latest.open !== null && latest.close !== null ? latest.high - Math.max(latest.open, latest.close) : null;
        const lowerWick = latest && latest.low !== null && latest.open !== null && latest.close !== null ? Math.min(latest.open, latest.close) - latest.low : null;
        const avgClose = mean(closes.slice(-10));
        const recentRanges = candles.slice(-10).flatMap((candle) => candle.high !== null && candle.low !== null ? [candle.high - candle.low] : []);
        const avgRange = mean(recentRanges);
        const shortRange = mean(recentRanges.slice(-3));
        const atr14 = atr(highs, lows, closes, 14);
        const lastFiveSeconds = ticks.filter((tick) => tick.eventTimestampEpochMs >= input.cutoffTimestamp - 5_000);
        const finalSecondsMomentum = lastFiveSeconds.length >= 2
            ? (lastFiveSeconds[lastFiveSeconds.length - 1]?.price ?? 0) - (lastFiveSeconds[0]?.price ?? 0)
            : null;
        const ema5 = ema(closes, 5);
        const ema13 = ema(closes, 13);
        const features = {
            momentum1: normalized(momentum1 ?? 0, atr14),
            momentum3: normalized(momentum3 ?? 0, atr14),
            velocity: normalized(velocity ?? 0, atr14),
            acceleration: normalized(acceleration ?? 0, atr14),
            volatility,
            bodyRatio: range !== null && range > 0 && body !== null ? body / range : null,
            upperWickRatio: range !== null && range > 0 && upperWick !== null ? upperWick / range : null,
            lowerWickRatio: range !== null && range > 0 && lowerWick !== null ? lowerWick / range : null,
            rejection: range !== null && range > 0 && upperWick !== null && lowerWick !== null ? (lowerWick - upperWick) / range : null,
            persistence: directionalSequence(candles.slice(-5)),
            tickImbalance: tickImbalance(ticks.slice(-100)),
            directionalSequence: directionalSequence(candles.slice(-4)),
            distanceFromMean: latestClose !== undefined && avgClose !== null ? normalized(latestClose - avgClose, atr14) : null,
            compression: shortRange !== null && avgRange !== null && avgRange > 0 ? 1 - shortRange / avgRange : null,
            expansion: range !== null && avgRange !== null && avgRange > 0 ? range / avgRange - 1 : null,
            trendStrength: ema5 !== null && ema13 !== null ? normalized(ema5 - ema13, atr14) : null,
            finalSecondsBehavior: normalized(finalSecondsMomentum ?? 0, atr14),
            rsi14: rsiWilder(closes, 14),
            ema5,
            ema13,
            atr14,
            stochastic14: stochastic(highs, lows, closes, 14),
            bollingerZ20: bollingerZ(closes, 20),
        };
        return {
            featureSchemaVersion: '2',
            computedAt: input.computedAt,
            informationCutoffTimestamp: input.cutoffTimestamp,
            usedPartialCandle: false,
            partialCandleCutoffTimestamp: null,
            features,
        };
    }
}
