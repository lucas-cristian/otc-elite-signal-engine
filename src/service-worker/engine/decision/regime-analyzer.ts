import { FeatureSnapshot, MarketRegimeSnapshot } from '../../../common/models/journal-types';

export class RegimeAnalyzer {
  public analyze(features: FeatureSnapshot, nowMs: number): MarketRegimeSnapshot {
    // Placeholder para a Fase 6
    return {
      structure: 'TREND_UP',
      volatility: 'NORMAL'
    };
  }
}

