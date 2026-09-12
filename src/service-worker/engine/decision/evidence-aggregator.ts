import type {
  EvidenceFamily,
  EvidenceSnapshot,
  SignalDirection,
  StrategyEvaluation,
} from '../../../common/models/journal-types.js';

const FAMILY_CAP = 1;
const FAMILY_WEIGHT: Readonly<Record<EvidenceFamily, number>> = {
  MOMENTUM: 1,
  REJECTION: 1,
  TICK_FLOW: 1,
  STRUCTURE: 1,
  REGIME: 0.5,
  DISTANCE: 0.75,
  CLASSICAL: 0.5,
};

export class EvidenceAggregator {
  public aggregate(strategies: readonly StrategyEvaluation[]): EvidenceSnapshot {
    const signedByFamily = new Map<EvidenceFamily, number>();
    for (const strategy of strategies) {
      for (const evidence of strategy.evidence) {
        const sign = evidence.direction === 'CALL' ? 1 : -1;
        signedByFamily.set(evidence.family, (signedByFamily.get(evidence.family) ?? 0) + sign * evidence.strength * strategy.rawScore);
      }
    }
    const familyScores: Partial<Record<EvidenceFamily, number>> = {};
    let numerator = 0;
    let denominator = 0;
    let clipped = false;
    for (const [family, raw] of signedByFamily) {
      const bounded = Math.max(-FAMILY_CAP, Math.min(FAMILY_CAP, raw));
      if (bounded !== raw) clipped = true;
      familyScores[family] = bounded;
      const weight = FAMILY_WEIGHT[family];
      numerator += bounded * weight;
      denominator += weight;
    }
    const signedScore = denominator === 0 ? 0 : numerator / denominator;
    const dominantDirection: SignalDirection | null = Math.abs(signedScore) < 0.05 ? null : signedScore > 0 ? 'CALL' : 'PUT';
    return {
      evidenceSchemaVersion: '2',
      familyScores,
      modelScore: Math.min(1, Math.abs(signedScore)),
      dominantDirection,
      denominator,
      clipped,
    };
  }
}
