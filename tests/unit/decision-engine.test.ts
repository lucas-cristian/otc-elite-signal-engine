import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionEngine } from '../../src/service-worker/engine/decision/decision-engine';
import { Candle, CandleLifecycle } from '../../src/common/models/types';
import { DecisionRecord } from '../../src/common/models/journal-types';

describe('DecisionEngine', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine({
      executionMode: 'LIVE',
      appVersion: '1.0.0',
      configHash: 'cfg_1',
      configSnapshot: {},
      expirationSeconds: 60,
      probabilityThreshold: 0.70
    });
  });

  function makeMockCandle(startTimestamp: number, lifecycle: CandleLifecycle): Candle {
    return {
      candleSchemaVersion: '1',
      asset: 'EURUSD',
      timeframe: 'M1',
      startTimestamp,
      endTimestamp: startTimestamp + 60000,
      lifecycle,
      gapAffected: false,
      open: 1.1000,
      high: 1.1050,
      low: 1.0950,
      close: 1.1020,
      tickCount: 50,
      timestampBasis: 'LOCAL_RECEIVED'
    };
  }

  it('evaluates a candle and produces a CALL decision if probability >= threshold', () => {
    const candle = makeMockCandle(1000, CandleLifecycle.CLOSED);
    
    // O mock EvidenceEvaluator retorna 0.75 de probabilidade e direção CALL
    const decision = engine.evaluateCandle(candle, 2000, 'OPTIMAL');

    expect(decision.finalDecision).toBe('CALL');
    expect(decision.blockers).toHaveLength(0);
    expect(decision.alertPublishedAt).toBe(2000);
    expect(decision.calibratedProbability).toBe(0.75);
    expect(decision.candidateDirection).toBe('CALL');
  });

  it('blocks decision if dataQuality is DEGRADED', () => {
    const candle = makeMockCandle(1000, CandleLifecycle.CLOSED);
    
    const decision = engine.evaluateCandle(candle, 2000, 'DEGRADED');

    expect(decision.finalDecision).toBe('BLOCKED');
    expect(decision.blockers).toContain('DATA_QUALITY_DEGRADED');
    expect(decision.alertPublishedAt).toBeNull();
    // O candidateDirection ainda deve ser o que o modelo calculou (CALL)
    expect(decision.candidateDirection).toBe('CALL');
  });

  it('blocks decision if probability is below threshold', () => {
    const strictEngine = new DecisionEngine({
      executionMode: 'LIVE',
      appVersion: '1.0.0',
      configHash: 'cfg_1',
      configSnapshot: {},
      expirationSeconds: 60,
      probabilityThreshold: 0.90 // O mock retorna 0.75
    });

    const candle = makeMockCandle(1000, CandleLifecycle.CLOSED);
    const decision = strictEngine.evaluateCandle(candle, 2000, 'OPTIMAL');

    expect(decision.finalDecision).toBe('BLOCKED');
    expect(decision.blockers).toContain('BELOW_PROBABILITY_THRESHOLD');
  });
});
