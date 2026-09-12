import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DecisionRecord, SignalRecord } from '../src/common/models/journal-types.js';
import type { MarketSourceIdentity, Tick } from '../src/common/models/types.js';
import { assessOperationalHealth, DEFAULT_DATA_HEALTH_THRESHOLDS } from '../src/service-worker/core/data-health.js';
import { DEFAULT_PIPELINE_CONFIG, QuantPipeline } from '../src/service-worker/core/quant-pipeline.js';
import { MemoryJournal } from '../src/service-worker/storage/memory-journal.js';

const identity: MarketSourceIdentity = {
  marketSourceIdentitySchemaVersion: '2',
  platform: 'POCKET_OPTION',
  canonicalAssetId: 'EURUSDOTC',
  marketType: 'OTC',
  source: 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON',
  feedId: 'api-us-south.po.market',
  instrumentId: 'EURUSD_otc',
  parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1',
};

function tick(receivedAtEpochMs: number): Tick {
  return {
    tickSchemaVersion: '4',
    tickId: `tick-${receivedAtEpochMs}`,
    marketSourceIdentity: identity,
    pageSessionId: 'page-a',
    connectionId: 'ws-a',
    sequence: 0,
    sourceTimestampEpochMs: receivedAtEpochMs + 7_200_000,
    receivedAtEpochMs,
    receivedAtMonotonicMs: 1,
    eventTimestampEpochMs: receivedAtEpochMs,
    timestampBasis: 'LOCAL_RECEIPT',
    sourceClockSynchronized: false,
    observedTimestampDeltaMs: -7_200_000,
    transportLatencyMs: null,
    price: 1.1,
    integrity: 'VALID',
    sourceQuality: 'VERIFIED',
    protocolVerificationId: 'TEST_VERIFIED_STREAM',
  };
}

function pendingDecision(): DecisionRecord {
  return {
    decisionSchemaVersion: '3',
    decisionId: 'decision-pending',
    decisionGranularityKey: 'granularity',
    executionMode: 'LIVE',
    canonicalAssetId: 'EURUSDOTC',
    timeframe: '5s',
    decisionComputedAt: 1_000,
    decisionPublishedAt: 1_000,
    alertPublishedAt: 1_000,
    evaluationWindowId: 'window',
    candleStartTimestamp: 0,
    candidateDirection: 'CALL',
    finalDecision: 'CALL',
    modelScore: 0.8,
    calibratedProbability: null,
    structureRegime: 'TREND_UP',
    volatilityRegime: 'NORMAL',
    strategySnapshots: [],
    featureSnapshot: null,
    evidenceSnapshot: null,
    sourceQuality: 'VERIFIED',
    sourceProtocolVerificationId: 'TEST_VERIFIED_STREAM',
    eventIntegrity: 'VALID',
    operationalDataState: 'HEALTHY',
    blockers: [],
    expirationSeconds: 60,
    configHash: 'config',
    configSnapshot: {},
    appVersion: '1.4.0',
    marketEpisodeId: null,
    createdAt: 1_000,
  };
}

function pendingSignal(): SignalRecord {
  return {
    signalSchemaVersion: '2',
    signalId: 'signal-pending',
    signalFingerprint: 'fingerprint',
    decisionId: 'decision-resolved',
    executionMode: 'LIVE',
    canonicalAssetId: 'EURUSDOTC',
    direction: 'CALL',
    referenceEntryPrice: 1.1,
    referenceEntryTimestamp: 1_000,
    expirationSeconds: 60,
    expectedExpiryTimestamp: 61_000,
    entryMarketSourceIdentity: identity,
    entryPageSessionId: 'page-a',
    payoutSnapshot: {
      payoutSnapshotSchemaVersion: '3',
      canonicalAssetId: 'EURUSDOTC',
      expirationSeconds: null,
      expirationBinding: 'UNBOUND',
      payoutRate: 0.8,
      capturedAt: 900,
      source: 'PLATFORM_PROTOCOL',
      quality: 'VERIFIED',
      feedId: 'api-us-south.po.market',
      parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1',
      protocolVerificationId: 'TEST_VERIFIED_PAYOUT',
    },
    signalCreatedAt: 1_000,
  };
}

test('data health changes with wall-clock age even when no new tick arrives', () => {
  const thresholds = DEFAULT_DATA_HEALTH_THRESHOLDS;
  assert.equal(assessOperationalHealth(null, 0, 1_000, thresholds).state, 'INITIALIZING');
  assert.equal(assessOperationalHealth(null, 0, 60_001, thresholds).state, 'DATA_UNAVAILABLE');
  assert.equal(assessOperationalHealth(1_000, 0, 6_000, thresholds).state, 'HEALTHY');
  assert.equal(assessOperationalHealth(1_000, 0, 6_001, thresholds).state, 'DEGRADED');
  assert.equal(assessOperationalHealth(1_000, 0, 16_001, thresholds).state, 'STALE');
  assert.equal(assessOperationalHealth(1_000, 0, 61_001, thresholds).state, 'DATA_UNAVAILABLE');
});

test('watchdog resolves overdue pending entry as feed stale without a new market tick', async () => {
  const journal = new MemoryJournal();
  await journal.appendTick(tick(1_000));
  await journal.appendDecision(pendingDecision());
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(1_000);
  await pipeline.watchdog(20_000);
  const snapshot = await journal.snapshot();
  assert.equal(pipeline.getOperationalHealth(20_000).state, 'STALE');
  assert.equal(snapshot.entryResolutions.length, 1);
  const entry = snapshot.entryResolutions[0];
  assert.ok(entry && entry.resolutionStatus === 'UNRESOLVED');
  assert.equal(entry.unresolvedReason, 'FEED_STALE');
});

test('watchdog resolves overdue pending result as DATA_UNAVAILABLE after prolonged feed loss', async () => {
  const journal = new MemoryJournal();
  await journal.appendTick(tick(1_000));
  await journal.appendSignal(pendingSignal());
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(1_000);
  await pipeline.watchdog(70_000);
  const snapshot = await journal.snapshot();
  assert.equal(pipeline.getOperationalHealth(70_000).state, 'DATA_UNAVAILABLE');
  assert.equal(snapshot.results.length, 1);
  const result = snapshot.results[0];
  assert.ok(result && result.resolutionStatus === 'UNRESOLVED');
  assert.equal(result.unresolvedReason, 'DATA_UNAVAILABLE');
});
