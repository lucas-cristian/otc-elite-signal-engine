import { FeatureSnapshot, MarketRegimeSnapshot, EvidenceSnapshot } from '../../../common/models/journal-types';

export interface EvidenceResult {
  snapshot: EvidenceSnapshot;
  combinedDirection: 'CALL' | 'PUT' | 'NONE';
  calibratedProbability: number;
  blockers: string[];
}

export class EvidenceEvaluator {
  public evaluate(features: FeatureSnapshot, regime: MarketRegimeSnapshot, nowMs: number): EvidenceResult {
    // Placeholder para a Fase 6
    return {
      snapshot: {
        combinedScore: 0.8,
        capped: false
      },
      combinedDirection: 'CALL', // ou PUT, ou NONE
      calibratedProbability: 0.75, // 0 a 1
      blockers: [] // se não vazio, o sinal é BLOCKED
    };
  }
}
