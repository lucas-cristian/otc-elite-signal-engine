function value(snapshot, key) {
    return snapshot.features[key] ?? null;
}
export class RegimeDetector {
    detect(features) {
        const trend = value(features, 'trendStrength');
        const persistence = value(features, 'persistence');
        const volatility = value(features, 'volatility');
        const expansion = value(features, 'expansion');
        if (trend === null || persistence === null)
            return { structure: 'UNKNOWN', volatility: 'UNKNOWN' };
        const structure = expansion !== null && expansion > 1.5
            ? 'CHAOTIC'
            : trend > 0.35 && persistence > 0.2
                ? 'TREND_UP'
                : trend < -0.35 && persistence < -0.2
                    ? 'TREND_DOWN'
                    : 'RANGE';
        const volatilityRegime = volatility === null
            ? 'UNKNOWN'
            : volatility < 0.0001
                ? 'LOW'
                : volatility > 0.003
                    ? 'HIGH'
                    : 'NORMAL';
        return { structure, volatility: volatilityRegime };
    }
}
