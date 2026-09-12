import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openJournalDB } from '../../src/service-worker/storage/idb-schema';
import { JournalStore, DuplicateJournalEntryError } from '../../src/service-worker/storage/journal-store';
import { JournalReader } from '../../src/service-worker/storage/journal-reader';
import {
  DecisionRecord,
  SignalRecord,
  ResultRecord,
  EntryResolutionRecord,
  ResolvedEntryRecord,
  ResolvedResultRecord,
  SettlementConfidence,
} from '../../src/common/models/journal-types';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeDecision(id: string, asset = 'EURUSD', createdAt = 1000): DecisionRecord {
  return {
    decisionId: id,
    decisionSchemaVersion: '1',
    executionMode: 'LIVE',
    asset,
    decisionComputedAt: createdAt,
    decisionPublishedAt: createdAt,
    alertPublishedAt: null,
    evaluationWindowId: `ew_${id}`,
    candleStartTimestamp: null,
    candidateDirection: 'CALL',
    finalDecision: 'CALL',
    modelScore: 0.72,
    calibratedProbability: 0.68,
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
    configHash: 'cfg_hash',
    configSnapshot: {},
    appVersion: '1.0.0',
    marketEpisodeId: null,
    createdAt,
  };
}

function makeEntryResolution(id: string, decisionId: string): ResolvedEntryRecord {
  return {
    resolutionStatus: 'RESOLVED',
    entryResolutionId: id,
    entryResolutionSchemaVersion: '1',
    decisionId,
    referenceEntryPrice: 1.1000,
    referenceEntryTimestamp: 2000,
    decisionPublishedAt: 1000,
    entryDelayMs: 1000,
    entrySource: 'WS_JSON',
    entryReferencePolicy: 'FIRST_TICK_AFTER_ALERT',
    entryMarketSourceIdentity: {} as any,
    entryPageSessionId: 'sess_1',
    entryTickId: 'tick_1',
    resolvedAt: 2000,
  };
}

function makeSignal(id: string, decisionId: string, asset = 'EURUSD'): SignalRecord {
  return {
    signalSchemaVersion: '1',
    signalId: id,
    signalFingerprint: `fp_${id}`,
    decisionId,
    executionMode: 'LIVE',
    asset,
    direction: 'CALL',
    referenceEntryPrice: 1.1000,
    referenceEntryTimestamp: 2000,
    expirationSeconds: 60,
    expectedExpiryTimestamp: 62000,
    entryMarketSourceIdentity: {} as any,
    signalCreatedAt: 2000,
  };
}

function makeResult(id: string, signalId: string): ResolvedResultRecord {
  return {
    resolutionStatus: 'RESOLVED',
    resultId: id,
    resultSchemaVersion: '1',
    signalId,
    evaluationMode: 'REFERENCE_FEED',
    referenceExitPrice: 1.1020,
    referenceExitTimestamp: 62050,
    expiryTimingErrorMs: 50,
    priceOutcome: 'UP',
    directionalOutcome: 'CORRECT',
    economicOutcome: 'WIN',
    economicReturn: 0.82,
    settlementMetadata: {
      settlementMetadataSchemaVersion: '1',
      confidence: SettlementConfidence.VERIFIED,
      source: 'PLATFORM_PROTOCOL',
      verifiedAt: 62100,
    },
    exitMarketSourceIdentity: {} as any,
    recoveredAcrossPageSession: false,
    entryPageSessionId: 'sess_1',
    exitPageSessionId: 'sess_1',
    evaluatedAt: 62100,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────

let store: JournalStore;
let reader: JournalReader;

beforeEach(async () => {
  // Cada teste recebe um IDB isolado via IDBFactory fresco
  const idb = new IDBFactory();
  const db = await openJournalDB(idb);
  store = new JournalStore(db);
  reader = new JournalReader(db);
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('JournalStore — append', () => {
  it('appends and retrieves a DecisionRecord', async () => {
    const decision = makeDecision('dec_1');
    await store.appendDecision(decision);

    const found = await reader.getDecisionById('dec_1');
    expect(found).toBeDefined();
    expect(found?.decisionId).toBe('dec_1');
    expect(found?.finalDecision).toBe('CALL');
  });

  it('appends and retrieves an EntryResolutionRecord', async () => {
    await store.appendDecision(makeDecision('dec_1'));
    await store.appendEntryResolution(makeEntryResolution('er_1', 'dec_1'));

    const found = await reader.getEntryResolutionByDecisionId('dec_1');
    expect(found?.entryResolutionId).toBe('er_1');
    expect((found as ResolvedEntryRecord).referenceEntryPrice).toBe(1.1000);
  });

  it('appends and retrieves a SignalRecord', async () => {
    await store.appendDecision(makeDecision('dec_1'));
    await store.appendSignal(makeSignal('sig_1', 'dec_1'));

    const found = await reader.getSignalById('sig_1');
    expect(found?.signalId).toBe('sig_1');
    expect(found?.direction).toBe('CALL');
  });

  it('appends and retrieves a ResultRecord', async () => {
    await store.appendDecision(makeDecision('dec_1'));
    await store.appendSignal(makeSignal('sig_1', 'dec_1'));
    await store.appendResult(makeResult('res_1', 'sig_1'));

    const found = await reader.getResultBySignalId('sig_1');
    expect(found?.resultId).toBe('res_1');
    expect((found as ResolvedResultRecord).directionalOutcome).toBe('CORRECT');
  });
});

describe('JournalStore — imutabilidade', () => {
  it('rejects duplicate DecisionRecord insertion', async () => {
    const decision = makeDecision('dec_dup');
    await store.appendDecision(decision);

    await expect(store.appendDecision(decision)).rejects.toThrow(DuplicateJournalEntryError);
  });

  it('rejects duplicate SignalRecord insertion', async () => {
    await store.appendDecision(makeDecision('dec_1'));
    const signal = makeSignal('sig_dup', 'dec_1');
    await store.appendSignal(signal);

    await expect(store.appendSignal(signal)).rejects.toThrow(DuplicateJournalEntryError);
  });

  it('allows different records with different IDs', async () => {
    await store.appendDecision(makeDecision('dec_1'));
    await store.appendDecision(makeDecision('dec_2'));

    const d1 = await reader.getDecisionById('dec_1');
    const d2 = await reader.getDecisionById('dec_2');
    expect(d1?.decisionId).toBe('dec_1');
    expect(d2?.decisionId).toBe('dec_2');
  });
});

describe('JournalReader — queries', () => {
  it('filters decisions by asset', async () => {
    await store.appendDecision(makeDecision('dec_EUR', 'EURUSD', 1000));
    await store.appendDecision(makeDecision('dec_GBP', 'GBPUSD', 2000));

    const eurDecisions = await reader.getDecisionsByAsset('EURUSD', 0);
    expect(eurDecisions).toHaveLength(1);
    expect(eurDecisions[0].decisionId).toBe('dec_EUR');
  });

  it('filters signals by asset and since timestamp', async () => {
    await store.appendDecision(makeDecision('dec_1', 'EURUSD', 1000));
    await store.appendDecision(makeDecision('dec_2', 'EURUSD', 5000));
    await store.appendSignal(makeSignal('sig_1', 'dec_1', 'EURUSD'));
    await store.appendSignal(makeSignal('sig_2', 'dec_2', 'EURUSD'));

    const all = await reader.getSignalsByAsset('EURUSD', 0);
    expect(all).toHaveLength(2);
  });

  it('listPendingResults returns signals without results', async () => {
    await store.appendDecision(makeDecision('dec_1'));
    const signal = makeSignal('sig_1', 'dec_1');
    signal.expectedExpiryTimestamp = 1000; // já expirou
    await store.appendSignal(signal);

    // Nenhum resultado registrado
    const pending = await reader.listPendingResults(9999);
    expect(pending).toHaveLength(1);
    expect(pending[0].signalId).toBe('sig_1');
  });

  it('listPendingResults excludes signals that already have results', async () => {
    await store.appendDecision(makeDecision('dec_1'));
    const signal = makeSignal('sig_1', 'dec_1');
    signal.expectedExpiryTimestamp = 1000;
    await store.appendSignal(signal);
    await store.appendResult(makeResult('res_1', 'sig_1'));

    const pending = await reader.listPendingResults(9999);
    expect(pending).toHaveLength(0);
  });
});
