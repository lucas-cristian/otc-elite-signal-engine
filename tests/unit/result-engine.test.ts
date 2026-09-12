import { describe, it, expect, beforeEach } from 'vitest';
import { ResultEngine } from '../../src/service-worker/evaluation/result-engine';
import { SignalRecord, ResolvedResultRecord, UnresolvedResultRecord } from '../../src/common/models/journal-types';
import { Tick } from '../../src/common/models/types';

describe('ResultEngine', () => {
  let engine: ResultEngine;

  beforeEach(() => {
    engine = new ResultEngine(5000); // Max timeout de 5 segundos
  });

  function makeSignal(direction: 'CALL' | 'PUT', referenceEntryPrice: number, expectedExpiryTimestamp: number): SignalRecord {
    return {
      signalSchemaVersion: '1',
      signalId: 'sig_1',
      signalFingerprint: 'fp_1',
      decisionId: 'dec_1',
      executionMode: 'LIVE',
      asset: 'EURUSD',
      direction,
      referenceEntryPrice,
      referenceEntryTimestamp: expectedExpiryTimestamp - 60000,
      expirationSeconds: 60,
      expectedExpiryTimestamp,
      entryMarketSourceIdentity: {
        marketSourceIdentitySchemaVersion: '1',
        platform: 'POCKET_OPTION',
        asset: 'EURUSD',
        marketType: 'OTC',
        source: 'WS_JSON',
        feedId: null,
        instrumentId: null,
        parserSchemaId: null
      },
      signalCreatedAt: expectedExpiryTimestamp - 60000
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

  it('ignores ticks before expectedExpiryTimestamp', () => {
    const signal = makeSignal('CALL', 1.1000, 5000);
    const tick = makeTick(4999, 1.1020);
    
    const result = engine.evaluateFromTick(signal, tick, 5000);
    expect(result).toBeNull();
  });

  it('resolves CALL as CORRECT if exit price > entry price', () => {
    const signal = makeSignal('CALL', 1.1000, 5000);
    const tick = makeTick(5050, 1.1020); // Saiu acima
    
    const result = engine.evaluateFromTick(signal, tick, 5055);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('RESOLVED');
    
    if (result!.status === 'RESOLVED') {
      const rec = result!.result as ResolvedResultRecord;
      expect(rec.priceOutcome).toBe('UP');
      expect(rec.directionalOutcome).toBe('CORRECT');
      expect(rec.economicOutcome).toBe('WIN');
      expect(rec.economicReturn).toBe(0.8);
    }
  });

  it('resolves CALL as INCORRECT if exit price < entry price', () => {
    const signal = makeSignal('CALL', 1.1000, 5000);
    const tick = makeTick(5050, 1.0990); // Saiu abaixo
    
    const result = engine.evaluateFromTick(signal, tick, 5055);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('RESOLVED');
    
    if (result!.status === 'RESOLVED') {
      const rec = result!.result as ResolvedResultRecord;
      expect(rec.priceOutcome).toBe('DOWN');
      expect(rec.directionalOutcome).toBe('INCORRECT');
      expect(rec.economicOutcome).toBe('LOSS');
      expect(rec.economicReturn).toBe(-1.0);
    }
  });

  it('resolves PUT as CORRECT if exit price < entry price', () => {
    const signal = makeSignal('PUT', 1.1000, 5000);
    const tick = makeTick(5050, 1.0990); // Saiu abaixo
    
    const result = engine.evaluateFromTick(signal, tick, 5055);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('RESOLVED');
    
    if (result!.status === 'RESOLVED') {
      const rec = result!.result as ResolvedResultRecord;
      expect(rec.priceOutcome).toBe('DOWN');
      expect(rec.directionalOutcome).toBe('CORRECT');
      expect(rec.economicOutcome).toBe('WIN');
      expect(rec.economicReturn).toBe(0.8);
    }
  });

  it('resolves FLAT if exit price === entry price', () => {
    const signal = makeSignal('CALL', 1.1000, 5000);
    const tick = makeTick(5050, 1.1000); // Igual
    
    const result = engine.evaluateFromTick(signal, tick, 5055);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('RESOLVED');
    
    if (result!.status === 'RESOLVED') {
      const rec = result!.result as ResolvedResultRecord;
      expect(rec.priceOutcome).toBe('FLAT');
      expect(rec.directionalOutcome).toBe('FLAT');
      expect(rec.economicOutcome).toBe('REFUND');
      expect(rec.economicReturn).toBe(0.0);
    }
  });

  it('returns UNRESOLVED if tick arrived after maxTimeoutMs from expiry', () => {
    const signal = makeSignal('CALL', 1.1000, 5000);
    // tick chegou 6000ms após a expiração (maxTimeoutMs = 5000)
    const tick = makeTick(11000, 1.1020); 
    
    const result = engine.evaluateFromTick(signal, tick, 11000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('UNRESOLVED');
    
    if (result!.status === 'UNRESOLVED') {
      const rec = result!.result as UnresolvedResultRecord;
      expect(rec.unresolvedReason).toBe('EXPIRY_TIMEOUT');
    }
  });

  it('returns UNRESOLVED if global clock exceeds maxTimeoutMs even with old ticks', () => {
    const signal = makeSignal('CALL', 1.1000, 5000);
    const tick = makeTick(4900, 1.1000); // tick do passado 
    
    // nowMs = 11000, já passou 6000ms da expiração
    const result = engine.evaluateFromTick(signal, tick, 11000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('UNRESOLVED');
  });
});
