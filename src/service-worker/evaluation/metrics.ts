/**
 * Motor de Estatísticas Científicas — Fase 7
 *
 * REGRAS:
 * - Taxa de acerto direcional: Wilson Confidence Interval (proporção)
 * - Edge econômico: Mean Reference Return + desvio padrão clássico
 * - Edge econômico é DESCRIPTIVE_ONLY na V1 (sem Out-Of-Sample)
 * - Coverage sempre exposta junto com P&L teórico (nunca ocultar limitações)
 */

import { SignalRecord, ResultRecord, ResolvedResultRecord } from '../../common/models/journal-types';

// ── Wilson Confidence Interval ─────────────────────────────────────────────

export interface WilsonCI {
  sampleSize: number;
  observedRate: number;
  lowerBound: number;
  upperBound: number;
  zScore: number;
}

export function wilsonCI(successes: number, total: number, z = 1.96): WilsonCI | null {
  if (total === 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return {
    sampleSize: total,
    observedRate: p,
    lowerBound: Math.max(0, center - margin),
    upperBound: Math.min(1, center + margin),
    zScore: z,
  };
}

// ── Economic Edge ──────────────────────────────────────────────────────────

export enum EconomicEvidenceStatus {
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  DESCRIPTIVE_ONLY = 'DESCRIPTIVE_ONLY',
  INCONCLUSIVE = 'INCONCLUSIVE',
  EVIDENCE_OF_POSITIVE_REFERENCE_EDGE = 'EVIDENCE_OF_POSITIVE_REFERENCE_EDGE',
}

export interface EconomicEdge {
  status: EconomicEvidenceStatus;
  economicSampleSize: number;
  observedMeanReferenceReturn: number | null;
  stdDev: number | null;
  totalReferenceReturn: number | null;
  verifiedCount: number;
  inferredCount: number;
  unknownCount: number;
}

export interface Analytics {
  decisionCount: number;
  callDecisionCount: number;
  putDecisionCount: number;
  blockedDecisionCount: number;
  entryResolvedCount: number;
  entryUnresolvedCount: number;
  entryResolutionRate: number | null;
  resolvedDirectionalSampleSize: number;
  correctCount: number;
  incorrectCount: number;
  flatCount: number;
  directionalAccuracy: WilsonCI | null;
  economicEdge: EconomicEdge;
  verifiedSettlementCount: number;
  inferredSettlementCount: number;
  unknownSettlementCount: number;
}

export function computeAnalytics(
  signals: SignalRecord[],
  results: ResultRecord[],
  decisions: { finalDecision: string }[],
): Analytics {
  const decisionCount = decisions.length;
  const callDecisionCount = decisions.filter((d) => d.finalDecision === 'CALL').length;
  const putDecisionCount = decisions.filter((d) => d.finalDecision === 'PUT').length;
  const blockedDecisionCount = decisions.filter(
    (d) => d.finalDecision === 'BLOCKED' || d.finalDecision === 'DATA_UNAVAILABLE',
  ).length;

  const entryResolvedCount = signals.length;
  const entryUnresolvedCount = Math.max(0, callDecisionCount + putDecisionCount - entryResolvedCount);
  const totalEntryAttempts = entryResolvedCount + entryUnresolvedCount;
  const entryResolutionRate = totalEntryAttempts > 0 ? entryResolvedCount / totalEntryAttempts : null;

  const resolvedResults = results.filter(
    (r): r is ResolvedResultRecord => r.resolutionStatus === 'RESOLVED',
  );

  const correctCount = resolvedResults.filter((r) => r.directionalOutcome === 'CORRECT').length;
  const incorrectCount = resolvedResults.filter((r) => r.directionalOutcome === 'INCORRECT').length;
  const flatCount = resolvedResults.filter((r) => r.directionalOutcome === 'FLAT').length;
  const resolvedDirectionalSampleSize = correctCount + incorrectCount + flatCount;
  const directionalAccuracy = wilsonCI(correctCount, correctCount + incorrectCount);

  const economicResults = resolvedResults.filter((r) => r.economicReturn !== null);
  const economicSampleSize = economicResults.length;
  let observedMeanReferenceReturn: number | null = null;
  let stdDev: number | null = null;
  let totalReferenceReturn: number | null = null;

  if (economicSampleSize > 0) {
    const returns = economicResults.map((r) => r.economicReturn as number);
    totalReferenceReturn = returns.reduce((a, b) => a + b, 0);
    observedMeanReferenceReturn = totalReferenceReturn / economicSampleSize;
    if (economicSampleSize > 1) {
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - observedMeanReferenceReturn!, 2), 0) / (economicSampleSize - 1);
      stdDev = Math.sqrt(variance);
    }
  }

  const economicStatus = economicSampleSize < 20
    ? EconomicEvidenceStatus.INSUFFICIENT_DATA
    : EconomicEvidenceStatus.DESCRIPTIVE_ONLY;

  const verifiedSettlementCount = resolvedResults.filter((r) => r.settlementMetadata.confidence === 'VERIFIED').length;
  const inferredSettlementCount = resolvedResults.filter((r) => r.settlementMetadata.confidence === 'INFERRED').length;
  const unknownSettlementCount = resolvedResults.filter((r) => r.settlementMetadata.confidence === 'UNKNOWN').length;

  return {
    decisionCount, callDecisionCount, putDecisionCount, blockedDecisionCount,
    entryResolvedCount, entryUnresolvedCount, entryResolutionRate,
    resolvedDirectionalSampleSize, correctCount, incorrectCount, flatCount,
    directionalAccuracy,
    economicEdge: { status: economicStatus, economicSampleSize, observedMeanReferenceReturn, stdDev, totalReferenceReturn, verifiedCount: verifiedSettlementCount, inferredCount: inferredSettlementCount, unknownCount: unknownSettlementCount },
    verifiedSettlementCount, inferredSettlementCount, unknownSettlementCount,
  };
}
