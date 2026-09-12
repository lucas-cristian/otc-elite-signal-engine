import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DecisionRecord, SignalRecord } from '../src/common/models/journal-types.js';
import type { MarketSourceIdentity, Tick } from '../src/common/models/types.js';
import { MemoryJournal } from '../src/service-worker/storage/memory-journal.js';
import { RecoveryService } from '../src/service-worker/storage/recovery-service.js';
import { ResultEngine } from '../src/service-worker/evaluation/result-engine.js';
import { QuantPipeline, DEFAULT_PIPELINE_CONFIG } from '../src/service-worker/core/quant-pipeline.js';
import { DatasetExporter } from '../src/service-worker/export/dataset-exporter.js';
import { ReplayEngine } from '../src/service-worker/replay/replay-engine.js';

const source: MarketSourceIdentity = {
  marketSourceIdentitySchemaVersion: '2', platform: 'POCKET_OPTION', canonicalAssetId: 'EURUSDOTC', marketType: 'OTC',
  source: 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON', feedId: 'demo-api-eu.po.market', instrumentId: 'EURUSD_otc', parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1',
};

function decision(): DecisionRecord {
  return {
    decisionSchemaVersion: '3', decisionId: 'd1', decisionGranularityKey: 'g1', executionMode: 'LIVE', canonicalAssetId: 'EURUSDOTC', timeframe: '5s',
    decisionComputedAt: 1000, decisionPublishedAt: 1000, alertPublishedAt: 1000, evaluationWindowId: 'e1', candleStartTimestamp: 0,
    candidateDirection: 'CALL', finalDecision: 'CALL', modelScore: 0.8, calibratedProbability: null, structureRegime: 'TREND_UP', volatilityRegime: 'NORMAL',
    strategySnapshots: [], featureSnapshot: null, evidenceSnapshot: null, sourceQuality: 'VERIFIED', sourceProtocolVerificationId: 'TEST_VERIFIED_STREAM', eventIntegrity: 'VALID', operationalDataState: 'HEALTHY', blockers: [],
    expirationSeconds: 60, configHash: 'cfg', configSnapshot: {}, appVersion: '1', marketEpisodeId: null, createdAt: 1000,
  };
}

function signal(): SignalRecord {
  return {
    signalSchemaVersion: '2', signalId: 's1', signalFingerprint: 'f1', decisionId: 'd1', executionMode: 'LIVE', canonicalAssetId: 'EURUSDOTC', direction: 'CALL',
    referenceEntryPrice: 10, referenceEntryTimestamp: 1000, expirationSeconds: 60, expectedExpiryTimestamp: 61_000, entryMarketSourceIdentity: source,
    entryPageSessionId: 'page-a', payoutSnapshot: {
      payoutSnapshotSchemaVersion: '3', canonicalAssetId: 'EURUSDOTC', expirationSeconds: null, expirationBinding: 'UNBOUND', payoutRate: 0.8, capturedAt: 900,
      source: 'PLATFORM_PROTOCOL', quality: 'VERIFIED', feedId: 'demo-api-eu.po.market', parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1', protocolVerificationId: 'TEST_VERIFIED_PAYOUT',
    }, signalCreatedAt: 1000,
  };
}

function tick(ts: number, price: number, seq: number, identity = source): Tick {
  return {
    tickSchemaVersion: '4', tickId: `tick-${seq}`, marketSourceIdentity: identity, pageSessionId: 'page-a', connectionId: 'c1', sequence: seq,
    sourceTimestampEpochMs: ts + 7_200_000, receivedAtEpochMs: ts, receivedAtMonotonicMs: seq, eventTimestampEpochMs: ts, timestampBasis: 'LOCAL_RECEIPT',
    sourceClockSynchronized: false, observedTimestampDeltaMs: -7_200_000, transportLatencyMs: null, price, integrity: 'VALID', sourceQuality: 'VERIFIED', protocolVerificationId: 'TEST_VERIFIED_STREAM',
  };
}

test('recovery derives pending work from append-only journal differences', async () => {
  const journal = new MemoryJournal();
  await journal.appendDecision(decision());
  let state = await new RecoveryService(journal).derive();
  assert.deepEqual(state.pendingEntries.map((item) => item.decisionId), ['d1']);
  await journal.appendEntryResolution({
    resolutionStatus: 'UNRESOLVED', entryResolutionSchemaVersion: '2', entryResolutionId: 'er1', decisionId: 'd1',
    referenceEntryPrice: null, referenceEntryTimestamp: null, maxEntryResolutionDelayMs: 3000, unresolvedReason: 'ENTRY_TIMEOUT', resolvedAt: 5000,
  });
  state = await new RecoveryService(journal).derive();
  assert.equal(state.pendingEntries.length, 0);
  await journal.appendSignal(signal());
  state = await new RecoveryService(journal).derive();
  assert.deepEqual(state.pendingResults.map((item) => item.signalId), ['s1']);
});

test('resolved result cannot use UNRESOLVED outcomes and flat does not invent refund', () => {
  const engine = new ResultEngine(5000);
  const flat = engine.evaluateFromTick(signal(), tick(61_000, 10, 1));
  assert.ok(flat && flat.resolutionStatus === 'RESOLVED');
  assert.equal(flat.priceOutcome, 'FLAT');
  assert.equal(flat.directionalOutcome, 'FLAT');
  assert.equal(flat.economicOutcome, 'UNKNOWN');
  assert.equal(flat.economicReturn, null);
});


test('economic evaluation fails closed when payout expiration is unknown or mismatched', () => {
  const engine = new ResultEngine(5000);
  const unknownExpiration = engine.evaluateFromTick(signal(), tick(61_000, 11, 2));
  assert.ok(unknownExpiration && unknownExpiration.resolutionStatus === 'RESOLVED');
  assert.equal(unknownExpiration.directionalOutcome, 'CORRECT');
  assert.equal(unknownExpiration.economicOutcome, 'UNKNOWN');
  assert.equal(unknownExpiration.economicReturn, null);
  assert.equal(unknownExpiration.economicEvaluationReason, 'PAYOUT_EXPIRATION_UNBOUND');

  const mismatchedSignal: SignalRecord = {
    ...signal(),
    payoutSnapshot: { ...signal().payoutSnapshot, expirationSeconds: 30, expirationBinding: 'EXPLICIT_PROTOCOL' },
  };
  const mismatched = engine.evaluateFromTick(mismatchedSignal, tick(61_000, 9, 3));
  assert.ok(mismatched && mismatched.resolutionStatus === 'RESOLVED');
  assert.equal(mismatched.directionalOutcome, 'INCORRECT');
  assert.equal(mismatched.economicOutcome, 'UNKNOWN');
  assert.equal(mismatched.economicReturn, null);
  assert.equal(mismatched.economicEvaluationReason, 'PAYOUT_EXPIRATION_MISMATCH');
});

test('economic evaluation is descriptive only when verified payout matches signal expiration', () => {
  const engine = new ResultEngine(5000);
  const eligibleSignal: SignalRecord = {
    ...signal(),
    payoutSnapshot: { ...signal().payoutSnapshot, expirationSeconds: 60, expirationBinding: 'EXPLICIT_PROTOCOL', payoutRate: 0.8, quality: 'VERIFIED' },
  };
  const win = engine.evaluateFromTick(eligibleSignal, tick(61_000, 11, 4));
  assert.ok(win && win.resolutionStatus === 'RESOLVED');
  assert.equal(win.economicOutcome, 'WIN');
  assert.equal(win.economicReturn, 0.8);
  assert.equal(win.economicEvaluationReason, 'ELIGIBLE');

  const loss = engine.evaluateFromTick(eligibleSignal, tick(61_000, 9, 5));
  assert.ok(loss && loss.resolutionStatus === 'RESOLVED');
  assert.equal(loss.economicOutcome, 'LOSS');
  assert.equal(loss.economicReturn, -1);
  assert.equal(loss.economicEvaluationReason, 'ELIGIBLE');
});

test('replay interleaves payout events and ticks through the same quantitative pipeline', async () => {
  const journal = new MemoryJournal();
  const config = { ...DEFAULT_PIPELINE_CONFIG, executionMode: 'LIVE' as const };
  const pipeline = new QuantPipeline(journal, config);
  await pipeline.initialize(1_700_000_000_000);
  const start = 1_700_000_000_000;
  const payout = {
    payoutSnapshotSchemaVersion: '3' as const, canonicalAssetId: 'EURUSDOTC', expirationSeconds: null, expirationBinding: 'UNBOUND' as const, payoutRate: 0.8, capturedAt: start,
    source: 'PLATFORM_PROTOCOL' as const, quality: 'VERIFIED' as const, feedId: 'demo-api-eu.po.market', parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1', protocolVerificationId: 'TEST_VERIFIED_PAYOUT',
  };
  await pipeline.enqueuePayout(payout);
  for (let index = 0; index < 150; index++) {
    const ts = start + index * 1000;
    const price = 1.1 + index * 0.00002 + Math.sin(index / 4) * 0.00005;
    await pipeline.enqueue({ tick: tick(ts, price, index) });
  }
  await pipeline.drain();
  const exporter = new DatasetExporter(journal);
  const createdAt = start + 200_000;
  await pipeline.finalizeThrough(createdAt);
  const dataset = await exporter.create({ appVersion: '1.4.0', buildId: 'test', sourceTreeSha256: 'source-hash', gitCommit: null, gitWorkingTreeClean: null, createdAt, operationalHealth: pipeline.getOperationalHealth(createdAt) });
  assert.ok(dataset.decisions.length > 0);
  assert.equal(dataset.payoutSnapshots.length, 1);
  const replay = await new ReplayEngine().replay(dataset, config);
  assert.deepEqual(replay.decisions.map((item) => item.decisionId), dataset.decisions.map((item) => item.decisionId));
  assert.deepEqual(replay.payoutSnapshots, dataset.payoutSnapshots);
});
