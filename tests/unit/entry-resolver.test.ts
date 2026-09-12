import { describe, it, expect, beforeEach } from 'vitest';
import { EntryResolver } from '../../src/service-worker/engine/decision/entry-resolver';
import { DecisionRecord, ResolvedEntryRecord, UnresolvedEntryRecord } from '../../src/common/models/journal-types';
import { Tick } from '../../src/common/models/types';

describe('EntryResolver', () => {
  let resolver: EntryResolver;

  beforeEach(() => {
    resolver = new EntryResolver(3000); // Max delay de 3 segundos
  });

  function makeDecision(alertPublishedAt: number | null, finalDecision: 'CALL' | 'PUT' | 'BLOCKED'): DecisionRecord {
    return {
      decisionId: 'dec_1',
      decisionSchemaVersion: '1',
      executionMode: 'LIVE',
      asset: 'EURUSD',
      decisionComputedAt: 1000,
      decisionPublishedAt: 1000,
      alertPublishedAt,
      evaluationWindowId: 'ew_1',
      candleStartTimestamp: 0,
      candidateDirection: 'CALL',
      finalDecision,
      modelScore: 0.8,
      calibratedProbability: 0.8,
      structureRegime: 'TREND_UP',
      volatilityRegime: 'NORMAL',
      strategySnapshots: null,
      featureSnapshot: null,
      regimeSnapshot: null,
      evidenceSnapshot: null,
      sourceQuality: 'VERIFIED',
      blockers: [],
      dataQuality: 'OPTIMAL',
      expirationSeconds: 60,
      configHash: 'cfg',
      configSnapshot: {},
      appVersion: '1.0',
      marketEpisodeId: null,
      createdAt: 1000
    };
  }

  function makeTick(eventTimestamp: number, price: number): Tick {
    return {
      tickSchemaVersion: '1',
      tickId: 'tick_1',
      marketSourceIdentity: {
        marketSourceIdentitySchemaVersion: '1',
        platform: 'POCKET_OPTION',
        asset: 'EURUSD',
        marketType: 'OTC',
        source: 'WS_JSON',
        feedId: null,
        instrumentId: null,
        parserSchemaId: null
      },
      pageSessionId: 'sess_1',
      eventTimestamp,
      price,
      timestampBasis: 'LOCAL_RECEIVED'
    };
  }

  it('ignores BLOCKED decisions', () => {
    const decision = makeDecision(null, 'BLOCKED');
    const tick = makeTick(1500, 1.1000);
    const result = resolver.resolveFromTick(decision, tick, 1500);
    expect(result).toBeNull();
  });

  it('ignores decisions without alertPublishedAt', () => {
    const decision = makeDecision(null, 'CALL');
    const tick = makeTick(1500, 1.1000);
    const result = resolver.resolveFromTick(decision, tick, 1500);
    expect(result).toBeNull();
  });

  it('ignores ticks that happened before alertPublishedAt', () => {
    const decision = makeDecision(2000, 'CALL');
    const tick = makeTick(1999, 1.1000);
    const result = resolver.resolveFromTick(decision, tick, 2000);
    expect(result).toBeNull(); // Still waiting
  });

  it('resolves entry and generates signal on valid next tick', () => {
    const decision = makeDecision(2000, 'CALL');
    const tick = makeTick(2050, 1.1020);
    
    const result = resolver.resolveFromTick(decision, tick, 2055);
    
    expect(result).not.toBeNull();
    expect(result!.status).toBe('RESOLVED');
    
    if (result!.status === 'RESOLVED') {
      expect(result!.entry.referenceEntryPrice).toBe(1.1020);
      expect(result!.entry.entryDelayMs).toBe(50);
      
      expect(result!.signal.direction).toBe('CALL');
      expect(result!.signal.referenceEntryPrice).toBe(1.1020);
      expect(result!.signal.expectedExpiryTimestamp).toBe(2050 + 60000); // entry time + 60s
    }
  });

  it('returns UNRESOLVED if tick delay exceeds maxDelayMs', () => {
    const decision = makeDecision(2000, 'CALL');
    // O tick chegou com 4000ms de atraso (max = 3000)
    const tick = makeTick(6000, 1.1020);
    
    const result = resolver.resolveFromTick(decision, tick, 6000);
    
    expect(result).not.toBeNull();
    expect(result!.status).toBe('UNRESOLVED');
    if (result!.status === 'UNRESOLVED') {
      expect(result!.entry.unresolvedReason).toBe('ENTRY_TIMEOUT');
    }
  });

  it('returns UNRESOLVED if system clock exceeds maxDelayMs (even if tick is older)', () => {
    const decision = makeDecision(2000, 'CALL');
    const tick = makeTick(1000, 1.1020); // tick do passado (ignorado)
    
    // O relógio global (nowMs) já passou do timeout
    const result = resolver.resolveFromTick(decision, tick, 5001);
    
    expect(result).not.toBeNull();
    expect(result!.status).toBe('UNRESOLVED');
    if (result!.status === 'UNRESOLVED') {
      expect(result!.entry.unresolvedReason).toBe('ENTRY_TIMEOUT');
    }
  });
});
