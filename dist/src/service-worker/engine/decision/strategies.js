function feature(snapshot, key) {
    return snapshot.features[key] ?? null;
}
function evaluation(strategyId, direction, rawScore, evidence, blockers) {
    return { strategyId, strategyVersion: '1', direction, rawScore, evidence, blockers };
}
export class MomentumStrategy {
    strategyId = 'MOMENTUM_V1';
    evaluate(features, regime) {
        const momentum = feature(features, 'momentum3');
        const flow = feature(features, 'tickImbalance');
        if (momentum === null || flow === null)
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['WARMUP_MOMENTUM']);
        if (regime.structure === 'CHAOTIC' || regime.structure === 'UNKNOWN')
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['REGIME_BLOCKED']);
        const rawScore = Math.min(1, Math.abs(momentum) * 0.7 + Math.abs(flow) * 0.3);
        if (rawScore < 0.2 || Math.sign(momentum) !== Math.sign(flow))
            return evaluation(this.strategyId, 'NO_TRADE', rawScore, [], []);
        const direction = momentum > 0 ? 'CALL' : 'PUT';
        return evaluation(this.strategyId, direction, rawScore, [
            { family: 'MOMENTUM', direction, strength: Math.min(1, Math.abs(momentum)) },
            { family: 'TICK_FLOW', direction, strength: Math.min(1, Math.abs(flow)) },
        ], []);
    }
}
export class ReversalStrategy {
    strategyId = 'REVERSAL_V1';
    evaluate(features, regime) {
        const rejection = feature(features, 'rejection');
        const z = feature(features, 'bollingerZ20');
        const rsi = feature(features, 'rsi14');
        if (rejection === null || z === null || rsi === null)
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['WARMUP_REVERSAL']);
        if (regime.structure !== 'RANGE')
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['REGIME_BLOCKED']);
        const bullish = rejection > 0.2 && z < -1 && rsi < 40;
        const bearish = rejection < -0.2 && z > 1 && rsi > 60;
        if (!bullish && !bearish)
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], []);
        const direction = bullish ? 'CALL' : 'PUT';
        const rawScore = Math.min(1, Math.abs(rejection) * 0.4 + Math.min(2, Math.abs(z)) / 2 * 0.35 + Math.abs(50 - rsi) / 50 * 0.25);
        return evaluation(this.strategyId, direction, rawScore, [
            { family: 'REJECTION', direction, strength: Math.min(1, Math.abs(rejection)) },
            { family: 'DISTANCE', direction, strength: Math.min(1, Math.abs(z) / 2) },
            { family: 'CLASSICAL', direction, strength: Math.min(1, Math.abs(50 - rsi) / 50) },
        ], []);
    }
}
export class ExhaustionStrategy {
    strategyId = 'EXHAUSTION_V1';
    evaluate(features, regime) {
        const acceleration = feature(features, 'acceleration');
        const finalSeconds = feature(features, 'finalSecondsBehavior');
        const expansion = feature(features, 'expansion');
        if (acceleration === null || finalSeconds === null || expansion === null)
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['WARMUP_EXHAUSTION']);
        if (regime.structure === 'CHAOTIC')
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['REGIME_BLOCKED']);
        const bullish = acceleration > 0.25 && finalSeconds > 0.2 && expansion > 0.25;
        const bearish = acceleration < -0.25 && finalSeconds < -0.2 && expansion > 0.25;
        if (!bullish && !bearish)
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], []);
        const direction = bullish ? 'CALL' : 'PUT';
        const rawScore = Math.min(1, (Math.abs(acceleration) + Math.abs(finalSeconds) + Math.min(1, expansion)) / 3);
        return evaluation(this.strategyId, direction, rawScore, [
            { family: 'MOMENTUM', direction, strength: Math.min(1, Math.abs(acceleration)) },
            { family: 'STRUCTURE', direction, strength: Math.min(1, Math.abs(finalSeconds)) },
        ], []);
    }
}
export class BreakoutStrategy {
    strategyId = 'BREAKOUT_V1';
    evaluate(features, regime) {
        const compression = feature(features, 'compression');
        const expansion = feature(features, 'expansion');
        const flow = feature(features, 'tickImbalance');
        if (compression === null || expansion === null || flow === null)
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['WARMUP_BREAKOUT']);
        if (regime.structure === 'CHAOTIC')
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['REGIME_BLOCKED']);
        if (compression < 0.15 || expansion < 0.15 || Math.abs(flow) < 0.2)
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], []);
        const direction = flow > 0 ? 'CALL' : 'PUT';
        const rawScore = Math.min(1, compression * 0.3 + expansion * 0.35 + Math.abs(flow) * 0.35);
        return evaluation(this.strategyId, direction, rawScore, [
            { family: 'STRUCTURE', direction, strength: Math.min(1, compression + expansion) },
            { family: 'TICK_FLOW', direction, strength: Math.min(1, Math.abs(flow)) },
        ], []);
    }
}
export class RejectionStrategy {
    strategyId = 'REJECTION_V1';
    evaluate(features, regime) {
        const rejection = feature(features, 'rejection');
        const imbalance = feature(features, 'tickImbalance');
        if (rejection === null || imbalance === null)
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['WARMUP_REJECTION']);
        if (regime.structure === 'CHAOTIC')
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], ['REGIME_BLOCKED']);
        if (Math.abs(rejection) < 0.25 || Math.sign(rejection) !== Math.sign(imbalance))
            return evaluation(this.strategyId, 'NO_TRADE', 0, [], []);
        const direction = rejection > 0 ? 'CALL' : 'PUT';
        const rawScore = Math.min(1, Math.abs(rejection) * 0.6 + Math.abs(imbalance) * 0.4);
        return evaluation(this.strategyId, direction, rawScore, [
            { family: 'REJECTION', direction, strength: Math.min(1, Math.abs(rejection)) },
            { family: 'TICK_FLOW', direction, strength: Math.min(1, Math.abs(imbalance)) },
        ], []);
    }
}
export class StrategySelector {
    strategies = [
        new MomentumStrategy(),
        new ReversalStrategy(),
        new ExhaustionStrategy(),
        new BreakoutStrategy(),
        new RejectionStrategy(),
    ];
    evaluate(features, regime) {
        if (regime.structure === 'CHAOTIC' || regime.volatility === 'UNKNOWN')
            return [];
        return this.strategies.map((strategy) => strategy.evaluate(features, regime));
    }
}
