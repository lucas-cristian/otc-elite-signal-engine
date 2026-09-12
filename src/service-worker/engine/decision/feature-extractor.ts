import { Candle } from '../../../common/models/types';
import { FeatureSnapshot } from '../../../common/models/journal-types';

export class FeatureExtractor {
  public extract(candle: Candle, nowMs: number): FeatureSnapshot {
    // Placeholder para a Fase 6
    return {
      computedAt: nowMs,
      informationCutoffTimestamp: candle.endTimestamp,
      usedPartialCandle: candle.lifecycle === 'FORMING',
      partialCandleCutoffTimestamp: candle.lifecycle === 'FORMING' ? nowMs : null,
      features: {
        'mock_feature': 1.0
      }
    };
  }
}
