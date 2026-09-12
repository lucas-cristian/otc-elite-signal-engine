import { Candle } from '../../../common/models/types';
import { DecisionRecord } from '../../../common/models/journal-types';
import { canonicalEntityHash } from '../../../common/hashing/canonical-hash';
import { FeatureExtractor } from './feature-extractor';
import { RegimeAnalyzer } from './regime-analyzer';
import { EvidenceEvaluator } from './evidence-evaluator';

import { ExecutionMode } from '../../../common/models/types';

export interface DecisionEngineConfig {
  executionMode: ExecutionMode;
  appVersion: string;
  configHash: string;
  configSnapshot: Record<string, unknown>;
  expirationSeconds: number; // Ex: 60 (1 minuto)
  probabilityThreshold: number; // Ex: 0.70
}

export class DecisionEngine {
  private featureExtractor = new FeatureExtractor();
  private regimeAnalyzer = new RegimeAnalyzer();
  private evidenceEvaluator = new EvidenceEvaluator();

  constructor(private readonly config: DecisionEngineConfig) {}

  public evaluateCandle(candle: Candle, nowMs: number, dataQuality: 'OPTIMAL' | 'DEGRADED'): DecisionRecord {
    const features = this.featureExtractor.extract(candle, nowMs);
    const regime = this.regimeAnalyzer.analyze(features, nowMs);
    const evidence = this.evidenceEvaluator.evaluate(features, regime, nowMs);

    let finalDecision: 'CALL' | 'PUT' | 'BLOCKED' = 'BLOCKED';
    let blockers = [...evidence.blockers];

    // Data Quality Blocker
    if (dataQuality === 'DEGRADED') {
      blockers.push('DATA_QUALITY_DEGRADED');
    }

    // Threshold Blocker
    if (evidence.calibratedProbability < this.config.probabilityThreshold) {
      blockers.push('BELOW_PROBABILITY_THRESHOLD');
    }

    // Direction Mapping
    if (blockers.length === 0) {
      if (evidence.combinedDirection === 'CALL') finalDecision = 'CALL';
      else if (evidence.combinedDirection === 'PUT') finalDecision = 'PUT';
      else blockers.push('INVALID_EVIDENCE_DIRECTION');
    }

    // Se houve algum blocker tardio
    if (blockers.length > 0) {
      finalDecision = 'BLOCKED';
    }

    // Candidate direction is what the model thought, regardless of blockers
    const candidateDirection: 'CALL' | 'PUT' | null =
      (evidence.combinedDirection === 'CALL' || evidence.combinedDirection === 'PUT')
        ? evidence.combinedDirection
        : null;

    // Geração determinística do decisionId
    const decisionId = canonicalEntityHash('DECISION', 1, {
      asset: candle.asset,
      candleStartTimestamp: candle.startTimestamp,
      nowMs,
      evidenceCombinedScore: evidence.snapshot.combinedScore ?? 0
    });

    const record: DecisionRecord = {
      decisionSchemaVersion: '1',
      decisionId,
      executionMode: this.config.executionMode,
      asset: candle.asset,
      decisionComputedAt: nowMs,
      decisionPublishedAt: nowMs,
      alertPublishedAt: finalDecision === 'CALL' || finalDecision === 'PUT' ? nowMs : null,
      evaluationWindowId: `ew_${candle.startTimestamp}`, // Agrupa por candle start
      candleStartTimestamp: candle.startTimestamp,

      candidateDirection,
      finalDecision,
      modelScore: evidence.snapshot.combinedScore,
      calibratedProbability: evidence.calibratedProbability,

      structureRegime: regime.structure,
      volatilityRegime: regime.volatility,

      strategySnapshots: null,
      featureSnapshot: features,
      regimeSnapshot: regime,
      evidenceSnapshot: evidence.snapshot,

      sourceQuality: 'VERIFIED', // Pode vir do CandleBuilder depois
      blockers,
      dataQuality,

      expirationSeconds: this.config.expirationSeconds,
      configHash: this.config.configHash,
      configSnapshot: this.config.configSnapshot,
      appVersion: this.config.appVersion,
      marketEpisodeId: null, // Futuro
      createdAt: nowMs
    };

    return record;
  }
}
