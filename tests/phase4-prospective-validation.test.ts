import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalEntityHash, canonicalJson } from '../src/common/hashing/canonical-hash.js';
import { sha256 } from '../src/common/hashing/sha256.js';
import type { ScientificDataset } from '../src/common/models/dataset-types.js';
import type { DecisionRecord, ResolvedEntryRecord, ResultRecord, SignalRecord } from '../src/common/models/journal-types.js';
import type { Tick } from '../src/common/models/types.js';
import type { JournalSnapshot } from '../src/service-worker/storage/journal-repository.js';
import { Phase4ValidationEngine } from '../src/scientific-validation/phase4/engine.js';
import { MemoryPhase4Repository } from '../src/scientific-validation/phase4/repository.js';
import {
  PHASE4_BASELINE_SCIENTIFIC_CORE_SHA256,
  PHASE4_TARGET_SAMPLE_SIZE,
  type Phase4BuildIdentity,
} from '../src/scientific-validation/phase4/types.js';
import { exactOneSidedBinomialPValue } from '../src/scientific-validation/statistics/exact-binomial.js';
import { wilsonInterval } from '../src/scientific-validation/statistics/wilson-interval.js';


async function expectRejects(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(pattern.test(message), `Expected ${pattern}, got ${message}`);
    return;
  }
  assert.ok(false, `Expected rejection matching ${pattern}`);
}

const source = {
  marketSourceIdentitySchemaVersion: '2' as const,
  platform: 'POCKET_OPTION' as const,
  canonicalAssetId: 'EURUSDOTC',
  marketType: 'OTC' as const,
  source: 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON' as const,
  feedId: 'demo-api-eu.po.market',
  instrumentId: 'EURUSD_otc',
  parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1',
};

const build: Phase4BuildIdentity = {
  appVersion: '1.9.2',
  buildId: 'test-build',
  sourceTreeSha256: 'a'.repeat(64),
  scientificCoreSha256: PHASE4_BASELINE_SCIENTIFIC_CORE_SHA256,
  phase4ValidationAuthoritySha256: 'c'.repeat(64),
  phase4ProtocolSha256: 'd'.repeat(64),
  gitCommit: 'b'.repeat(40),
  gitWorkingTreeClean: true,
  gitProvenance: 'GIT',
};

function emptySnapshot(): JournalSnapshot {
  return { ticks: [], payoutSnapshots: [], candles: [], decisions: [], entryResolutions: [], decisionSignalLinks: [], signals: [], results: [], continuityEvents: [], transportEvents: [] };
}

function decision(id: string, marketEpisodeId: string, createdAt: number, configHash = 'frozen-config'): DecisionRecord {
  return {
    decisionSchemaVersion: '5', decisionId: id, decisionGranularityKey: `granularity-${id}`, executionMode: 'LIVE', canonicalAssetId: 'EURUSDOTC', feedEpochId: 'epoch-1', timeframe: '5s', decisionComputedAt: createdAt - 5, decisionPublishedAt: createdAt - 5, alertPublishedAt: null, evaluationWindowId: `window-${id}`, candleStartTimestamp: createdAt - 5_000, candidateDirection: 'CALL', finalDecision: 'CALL', modelScore: 0.6, calibratedProbability: null, structureRegime: 'RANGE', volatilityRegime: 'NORMAL', strategySnapshots: [{ strategyId: 'MOMENTUM_V1', strategyVersion: '1', direction: 'CALL', rawScore: 0.6, evidence: [], blockers: [] }], featureSnapshot: null, evidenceSnapshot: null, sourceQuality: 'VERIFIED', sourceFeedId: source.feedId, sourceProtocolVerificationId: 'TEST_PROTOCOL', eventIntegrity: 'VALID', operationalDataState: 'HEALTHY', blockers: [], expirationSeconds: 60, configHash, configSnapshot: {}, appVersion: '1.9.2', marketEpisodeId, arbitrationStatus: 'PRIMARY', createdAt,
  };
}

function entry(decisionId: string, createdAt: number): ResolvedEntryRecord {
  return {
    resolutionStatus: 'RESOLVED', entryResolutionSchemaVersion: '2', entryResolutionId: `entry-${decisionId}`, decisionId, referenceEntryPrice: 1.1, referenceEntryTimestamp: createdAt, decisionPublishedAt: createdAt - 5, entryDelayMs: 5, entryReferencePolicy: 'FIRST_TICK_AFTER_ALERT', entryMarketSourceIdentity: source, entryPageSessionId: 'page-1', entryTickId: `tick-${decisionId}`, resolvedAt: createdAt,
  };
}

function signal(id: string, decisionId: string, marketEpisodeId: string, createdAt: number): SignalRecord {
  return {
    signalSchemaVersion: '4', signalId: id, signalFingerprint: `fingerprint-${id}`, decisionId, marketEpisodeId, feedEpochId: 'epoch-1', executionMode: 'LIVE', canonicalAssetId: 'EURUSDOTC', direction: 'CALL', referenceEntryPrice: 1.1, referenceEntryTimestamp: createdAt, expirationSeconds: 60, expectedExpiryTimestamp: createdAt + 60_000, entryMarketSourceIdentity: source, entryPageSessionId: 'page-1', payoutSnapshot: { payoutSnapshotSchemaVersion: '3', canonicalAssetId: 'EURUSDOTC', expirationSeconds: null, expirationBinding: 'UNBOUND', payoutRate: 0.8, capturedAt: createdAt, source: 'PLATFORM_PROTOCOL', quality: 'VERIFIED', feedId: source.feedId, parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1', protocolVerificationId: 'TEST_PAYOUT' }, signalCreatedAt: createdAt,
  };
}

function result(signalId: string, evaluatedAt: number, outcome: 'CORRECT' | 'INCORRECT' | 'FLAT' = 'CORRECT', timing = 100): ResultRecord {
  return {
    resolutionStatus: 'RESOLVED', resultSchemaVersion: '3', resultId: `result-${signalId}`, signalId, evaluationMode: 'REFERENCE_FEED', referenceExitPrice: outcome === 'FLAT' ? 1.1 : outcome === 'CORRECT' ? 1.2 : 1.0, referenceExitTimestamp: evaluatedAt, expiryTimingErrorMs: timing, priceOutcome: outcome === 'FLAT' ? 'FLAT' : outcome === 'CORRECT' ? 'UP' : 'DOWN', directionalOutcome: outcome, economicOutcome: 'UNKNOWN', economicReturn: null, economicEvaluationReason: outcome === 'FLAT' ? 'FLAT_REFERENCE_OUTCOME' : 'PAYOUT_EXPIRATION_UNBOUND', settlementMetadata: { settlementMetadataSchemaVersion: '2', confidence: 'UNKNOWN', source: null, verifiedAt: null }, exitMarketSourceIdentity: source, recoveredAcrossPageSession: false, entryPageSessionId: 'page-1', exitPageSessionId: 'page-1', evaluatedAt,
  };
}

function tick(id: string, timestamp: number, price: number): Tick {
  return {
    tickSchemaVersion: '4', tickId: id, marketSourceIdentity: source, pageSessionId: 'page-1', connectionId: 'test-connection', sequence: timestamp,
    sourceTimestampEpochMs: null, receivedAtEpochMs: timestamp, receivedAtMonotonicMs: timestamp, eventTimestampEpochMs: timestamp,
    timestampBasis: 'LOCAL_RECEIPT', sourceClockSynchronized: false, observedTimestampDeltaMs: null, transportLatencyMs: null,
    price, integrity: 'VALID', sourceQuality: 'VERIFIED', protocolVerificationId: 'TEST_PROTOCOL',
  };
}

function withEpisode(snapshot: JournalSnapshot, ordinal: number, createdAt: number, outcome: 'CORRECT' | 'INCORRECT' = 'CORRECT', timing = 100, configHash = 'frozen-config'): void {
  const episodeId = `episode-${ordinal.toString().padStart(4, '0')}`;
  const decisionId = `decision-${ordinal}`;
  const signalId = `signal-${ordinal}`;
  const decisionRecord = decision(decisionId, episodeId, createdAt, configHash);
  const entryRecord = entry(decisionId, createdAt);
  const signalRecord = signal(signalId, decisionId, episodeId, createdAt);
  const resultRecord = result(signalId, createdAt + 60_000 + timing, outcome, timing);
  snapshot.decisions.push(decisionRecord);
  snapshot.entryResolutions.push(entryRecord);
  snapshot.signals.push(signalRecord);
  snapshot.results.push(resultRecord);
  snapshot.ticks.push(tick(entryRecord.entryTickId, entryRecord.referenceEntryTimestamp, entryRecord.referenceEntryPrice));
  if (resultRecord.resolutionStatus === 'RESOLVED') snapshot.ticks.push(tick(`exit-${signalId}`, resultRecord.referenceExitTimestamp, resultRecord.referenceExitPrice));
}

async function startedEngine(startAt = 10_000): Promise<{ engine: Phase4ValidationEngine; snapshot: JournalSnapshot }> {
  const repository = new MemoryPhase4Repository();
  const engine = new Phase4ValidationEngine(repository);
  const snapshot = emptySnapshot();
  snapshot.decisions.push(decision('seed-decision', 'seed-episode', startAt - 1_000));
  await engine.startExperiment(snapshot, build, startAt);
  snapshot.decisions.length = 0;
  return { engine, snapshot };
}

function datasetFrom(snapshot: JournalSnapshot, configHash: string, createdAt = 999_999): ScientificDataset {
  const body = { ...snapshot };
  const checksumSha256 = sha256(new TextEncoder().encode(canonicalJson(body)));
  const manifestBase = {
    datasetSchemaVersion: '10' as const,
    createdAt,
    appVersion: '1.9.2',
    buildId: build.buildId,
    sourceTreeSha256: build.sourceTreeSha256,
    scientificCoreSha256: build.scientificCoreSha256,
    phase4ValidationAuthoritySha256: build.phase4ValidationAuthoritySha256,
    phase4ProtocolSha256: build.phase4ProtocolSha256,
    gitCommit: build.gitCommit,
    gitWorkingTreeClean: true,
    gitProvenance: 'GIT' as const,
    protocolRegistryVersion: 'TEST',
    protocolVerificationIds: [],
    exportOperationalDataState: 'HEALTHY' as const,
    exportOperationalDataReason: 'FRESH',
    latestTickAgeMsAtExport: 0,
    assetFeedHealthAtExport: [],
    captureTransportAtExport: { transportSchemaVersion: '4' as const, tabId: null, pageSessionId: null, connected: true, visibility: 'hidden' as const, frozen: false, discarded: false, autoDiscardable: false, lastSemanticEventAt: 999_999, lastLifecycleEventAt: null, lastConnectionEventAt: null, lastLifecycleReason: null, shadowConnected: true, shadowPrimary: true, shadowState: 'STREAMING' as const, shadowEndpointHost: source.feedId, shadowReconnectAttempts: 0, shadowConsecutiveNamespaceRejects: 0, shadowCircuitOpen: false, shadowLastMessageAt: 999_999, shadowLastPriceAt: 999_999, shadowLastErrorReason: null, shadowLastCommandAt: null, mitigation: 'MAIN_WORLD_NATIVE_SHADOW_RUNTIME_PORT_WATCHDOG_AUTO_DISCARD_DISABLED' as const },
    tickCount: snapshot.ticks.length, decisionCount: snapshot.decisions.length, rawCandidateDecisionCount: snapshot.decisions.length, marketEpisodeCount: snapshot.decisions.length, suppressedCorrelatedDecisionCount: 0, signalCount: snapshot.signals.length, resultCount: snapshot.results.length, continuityEventCount: 0, transportEventCount: 0, reconnectEventCount: 0, configHashes: [configHash], checksumSha256,
  };
  const manifest = { ...manifestBase, datasetId: canonicalEntityHash('DATASET', 10, manifestBase) };
  return { manifest, ...body };
}

test('exact binomial and Wilson vectors are deterministic', () => {
  assert.equal(exactOneSidedBinomialPValue(10, 10, 0.5), 1 / 1024);
  const interval = wilsonInterval(15, 21, 0.99);
  assert.ok(interval);
  assert.ok(interval.low > 0.43 && interval.low < 0.44);
  assert.ok(interval.high > 0.89 && interval.high < 0.891);
});

test('Phase 4 excludes pre-period, flat and >1000ms outcomes while accepting 1000ms exactly', async () => {
  const { engine, snapshot } = await startedEngine();
  withEpisode(snapshot, 1, 9_999, 'CORRECT', 100);
  withEpisode(snapshot, 2, 10_100, 'CORRECT', 1_000);
  withEpisode(snapshot, 3, 10_200, 'CORRECT', 1_001);
  const flatDecision = decision('decision-flat', 'episode-flat', 10_300);
  snapshot.decisions.push(flatDecision);
  snapshot.entryResolutions.push(entry(flatDecision.decisionId, 10_300));
  const flatEntry = entry(flatDecision.decisionId, 10_300);
  const flatSignal = signal('signal-flat', flatDecision.decisionId, 'episode-flat', 10_300);
  const flatResult = result('signal-flat', 70_400, 'FLAT', 100);
  snapshot.entryResolutions[snapshot.entryResolutions.length - 1] = flatEntry;
  snapshot.signals.push(flatSignal);
  snapshot.results.push(flatResult);
  snapshot.ticks.push(tick(flatEntry.entryTickId, flatEntry.referenceEntryTimestamp, flatEntry.referenceEntryPrice));
  if (flatResult.resolutionStatus === 'RESOLVED') snapshot.ticks.push(tick('exit-signal-flat', flatResult.referenceExitTimestamp, flatResult.referenceExitPrice));
  const report = await engine.syncLiveJournal(snapshot, build, 100_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 1);
  assert.equal(report.correct, 1);
  assert.equal(report.exclusionsByReason.PRE_PROSPECTIVE_PERIOD, 1);
  assert.equal(report.exclusionsByReason.EXPIRY_TIMING_OUTSIDE_STRICT_WINDOW, 1);
  assert.equal(report.exclusionsByReason.FLAT_DIRECTIONAL_OUTCOME, 1);
});

test('live resync and repeated dataset import never double-count a market episode', async () => {
  const { engine, snapshot } = await startedEngine();
  withEpisode(snapshot, 1, 10_100);
  await engine.syncLiveJournal(snapshot, build, 100_000);
  const again = await engine.syncLiveJournal(snapshot, build, 100_100);
  assert.equal(again.prospectiveUniqueStrictEpisodes, 1);

  const second = emptySnapshot();
  withEpisode(second, 2, 10_200);
  const ds = datasetFrom(second, 'frozen-config');
  const json = JSON.stringify(ds);
  const afterImport = await engine.importDatasetJson(json, 101_000);
  assert.equal(afterImport.prospectiveUniqueStrictEpisodes, 2);
  const duplicateImport = await engine.importDatasetJson(json, 102_000);
  assert.equal(duplicateImport.prospectiveUniqueStrictEpisodes, 2);
  assert.equal(duplicateImport.importedDatasetCount, 1);
});

test('n below 500 can never pass even with perfect accuracy', async () => {
  const { engine, snapshot } = await startedEngine();
  for (let index = 0; index < PHASE4_TARGET_SAMPLE_SIZE - 1; index += 1) withEpisode(snapshot, index + 1, 20_000 + index * 70_000, 'CORRECT');
  const report = await engine.syncLiveJournal(snapshot, build, 100_000_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 499);
  assert.equal(report.status, 'COLLECTING');
  assert.equal(report.confirmatoryEligible, false);
  assert.equal(report.confirmatoryEvaluation, null);
});

test('500 stable episodes with strong edge produce PASS', async () => {
  const { engine, snapshot } = await startedEngine();
  for (let block = 0; block < 5; block += 1) {
    for (let offset = 0; offset < 100; offset += 1) {
      const ordinal = block * 100 + offset + 1;
      withEpisode(snapshot, ordinal, 20_000 + ordinal * 70_000, offset < 64 ? 'CORRECT' : 'INCORRECT');
    }
  }
  const report = await engine.syncLiveJournal(snapshot, build, 100_000_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 500);
  assert.equal(report.status, 'PASS');
  assert.equal(report.confirmatoryEvaluation?.finalStatus, 'PASS');
  assert.equal(report.confirmatoryEvaluation?.correct, 320);
  assert.equal(report.confirmatoryEvaluation?.stabilityGate, 'PASS');
  assert.equal(report.confirmatoryEvaluation?.statisticalGate, 'PASS');
});

test('500 episodes at chance level produce FAIL', async () => {
  const { engine, snapshot } = await startedEngine();
  for (let index = 0; index < 500; index += 1) withEpisode(snapshot, index + 1, 20_000 + index * 70_000, index % 2 === 0 ? 'CORRECT' : 'INCORRECT');
  const report = await engine.syncLiveJournal(snapshot, build, 100_000_000);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.confirmatoryEvaluation?.statisticalGate, 'FAIL');
});

test('scientific core mismatch invalidates experiment instead of declaring strategy failure', async () => {
  const { engine, snapshot } = await startedEngine();
  const report = await engine.syncLiveJournal(snapshot, { ...build, scientificCoreSha256: 'e'.repeat(64) }, 20_000);
  assert.equal(report.status, 'INVALIDATED');
  assert.equal(report.integrityGate, 'FAIL');
});

test('Phase 4 dataset replay is deterministic regardless of import order', async () => {
  const { Phase4ReplayEngine } = await import('../src/scientific-validation/phase4/replay.js');
  const { engine } = await startedEngine();
  const baseReport = await engine.report();
  assert.ok(baseReport.experiment);

  const first = emptySnapshot();
  withEpisode(first, 10, 10_500, 'CORRECT');
  const second = emptySnapshot();
  withEpisode(second, 11, 10_600, 'INCORRECT');
  const firstJson = JSON.stringify(datasetFrom(first, 'frozen-config'));
  const secondJson = JSON.stringify(datasetFrom(second, 'frozen-config'));

  const replay = new Phase4ReplayEngine();
  const a = await replay.replay(baseReport.experiment, [firstJson, secondJson]);
  const b = await replay.replay(baseReport.experiment, [secondJson, firstJson]);
  assert.equal(a.prospectiveUniqueStrictEpisodes, b.prospectiveUniqueStrictEpisodes);
  assert.equal(a.correct, b.correct);
  assert.equal(a.incorrect, b.incorrect);
  assert.equal(a.accuracy, b.accuracy);
  assert.equal(a.exactBinomialPValue, b.exactBinomialPValue);
  assert.equal(a.wilson99Low, b.wilson99Low);
  assert.equal(a.wilson99High, b.wilson99High);
});

test('same market episode across two distinct datasets is counted once and recorded as duplicate', async () => {
  const { engine } = await startedEngine();
  const snapshot = emptySnapshot();
  withEpisode(snapshot, 30, 11_000, 'CORRECT');
  const first = JSON.stringify(datasetFrom(snapshot, 'frozen-config', 200_000));
  const second = JSON.stringify(datasetFrom(snapshot, 'frozen-config', 300_000));
  await engine.importDatasetJson(first, 200_000);
  const report = await engine.importDatasetJson(second, 300_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 1);
  assert.equal(report.importedDatasetCount, 2);
  assert.equal(report.duplicateEpisodeCount, 1);
});

test('config mismatch and unverified source are explicitly excluded', async () => {
  const { engine, snapshot } = await startedEngine();
  withEpisode(snapshot, 40, 11_000, 'CORRECT', 100, 'wrong-config');
  const badDecision = decision('decision-unverified', 'episode-unverified', 12_000);
  badDecision.sourceQuality = 'INFERRED';
  snapshot.decisions.push(badDecision);
  snapshot.entryResolutions.push(entry(badDecision.decisionId, 12_000));
  snapshot.signals.push(signal('signal-unverified', badDecision.decisionId, 'episode-unverified', 12_000));
  snapshot.results.push(result('signal-unverified', 72_100, 'CORRECT', 100));
  const report = await engine.syncLiveJournal(snapshot, build, 100_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 0);
  assert.equal(report.exclusionsByReason.CONFIG_HASH_MISMATCH, 1);
  assert.equal(report.exclusionsByReason.UNVERIFIED_SOURCE, 1);
});

test('unresolved result is excluded and never enters the directional denominator', async () => {
  const { engine, snapshot } = await startedEngine();
  const d = decision('decision-unresolved', 'episode-unresolved', 12_000);
  const s = signal('signal-unresolved', d.decisionId, 'episode-unresolved', 12_000);
  snapshot.decisions.push(d);
  const unresolvedEntry = entry(d.decisionId, 12_000);
  snapshot.entryResolutions.push(unresolvedEntry);
  snapshot.ticks.push(tick(unresolvedEntry.entryTickId, unresolvedEntry.referenceEntryTimestamp, unresolvedEntry.referenceEntryPrice));
  snapshot.signals.push(s);
  snapshot.results.push({
    resolutionStatus: 'UNRESOLVED', resultSchemaVersion: '3', resultId: 'result-unresolved', signalId: s.signalId, evaluationMode: 'REFERENCE_FEED', referenceExitPrice: null, referenceExitTimestamp: null, expiryTimingErrorMs: null, priceOutcome: 'UNRESOLVED', directionalOutcome: 'UNRESOLVED', economicOutcome: 'UNKNOWN', economicReturn: null, economicEvaluationReason: 'RESULT_UNRESOLVED', settlementMetadata: { settlementMetadataSchemaVersion: '2', confidence: 'UNKNOWN', source: null, verifiedAt: null }, exitMarketSourceIdentity: null, unresolvedReason: 'DATA_UNAVAILABLE', evaluatedAt: 80_000,
  });
  const report = await engine.syncLiveJournal(snapshot, build, 100_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 0);
  assert.equal(report.exclusionsByReason.RESULT_UNRESOLVED, 1);
});

test('validation authority, protocol and clean GIT provenance are frozen after start', async () => {
  const { engine, snapshot } = await startedEngine();
  let report = await engine.syncLiveJournal(snapshot, { ...build, phase4ValidationAuthoritySha256: 'e'.repeat(64) }, 20_000);
  assert.equal(report.status, 'INVALIDATED');

  const second = await startedEngine(30_000);
  report = await second.engine.syncLiveJournal(second.snapshot, { ...build, phase4ProtocolSha256: 'f'.repeat(64) }, 40_000);
  assert.equal(report.status, 'INVALIDATED');

  const third = await startedEngine(50_000);
  report = await third.engine.syncLiveJournal(third.snapshot, { ...build, gitWorkingTreeClean: false }, 60_000);
  assert.equal(report.status, 'INVALIDATED');
});


test('live collection is bound to the exact frozen Git commit', async () => {
  const { engine, snapshot } = await startedEngine();
  const report = await engine.syncLiveJournal(snapshot, { ...build, gitCommit: 'e'.repeat(40) }, 20_000);
  assert.equal(report.status, 'INVALIDATED');
  assert.equal(report.integrityGate, 'FAIL');
});

test('schema v10 import rejects dirty provenance and mismatched validation authority', async () => {
  const { engine } = await startedEngine();
  const snapshot = emptySnapshot();
  withEpisode(snapshot, 70, 12_000, 'CORRECT');
  const dirty = datasetFrom(snapshot, 'frozen-config');
  dirty.manifest.gitWorkingTreeClean = false;
  const { datasetId: _dirtyId, ...dirtyManifestBase } = dirty.manifest;
  dirty.manifest.datasetId = canonicalEntityHash('DATASET', 10, dirtyManifestBase);
  await expectRejects(() => engine.importDatasetJson(JSON.stringify(dirty), 200_000), /working tree/i);

  const badAuthority = datasetFrom(snapshot, 'frozen-config', 300_000);
  badAuthority.manifest.phase4ValidationAuthoritySha256 = 'f'.repeat(64);
  const { datasetId: _authorityId, ...authorityManifestBase } = badAuthority.manifest;
  badAuthority.manifest.datasetId = canonicalEntityHash('DATASET', 10, authorityManifestBase);
  await expectRejects(() => engine.importDatasetJson(JSON.stringify(badAuthority), 300_000), /validation authority/i);
});


test('schema v10 import is bound to the exact frozen Git commit', async () => {
  const { engine } = await startedEngine();
  const snapshot = emptySnapshot();
  withEpisode(snapshot, 75, 12_500, 'CORRECT');
  const dataset = datasetFrom(snapshot, 'frozen-config');
  dataset.manifest.gitCommit = 'f'.repeat(40);
  const { datasetId: _id, ...manifestBase } = dataset.manifest;
  dataset.manifest.datasetId = canonicalEntityHash('DATASET', 10, manifestBase);
  await expectRejects(() => engine.importDatasetJson(JSON.stringify(dataset), 300_000), /Git commit/i);
});

test('semantic eligibility rejects negative timing, timeline tampering and outcome tampering', async () => {
  const first = await startedEngine();
  withEpisode(first.snapshot, 80, 12_000, 'CORRECT', -1);
  let report = await first.engine.syncLiveJournal(first.snapshot, build, 100_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 0);
  assert.equal(report.exclusionsByReason.INVALID_EXPIRY_TIMING, 1);

  const second = await startedEngine(20_000);
  withEpisode(second.snapshot, 81, 21_000, 'CORRECT', 100);
  const s = second.snapshot.signals[0];
  if (!s) throw new Error('signal missing');
  s.expectedExpiryTimestamp += 1;
  report = await second.engine.syncLiveJournal(second.snapshot, build, 200_000);
  assert.equal(report.exclusionsByReason.REFERENCE_TIMELINE_MISMATCH, 1);

  const third = await startedEngine(30_000);
  withEpisode(third.snapshot, 82, 31_000, 'CORRECT', 100);
  const r = third.snapshot.results[0];
  if (!r || r.resolutionStatus !== 'RESOLVED') throw new Error('result missing');
  r.directionalOutcome = 'INCORRECT';
  report = await third.engine.syncLiveJournal(third.snapshot, build, 300_000);
  assert.equal(report.exclusionsByReason.REFERENCE_TIMELINE_MISMATCH, 1);
});

test('repeated live resync does not inflate exclusion counts', async () => {
  const { engine, snapshot } = await startedEngine();
  withEpisode(snapshot, 90, 9_000, 'CORRECT');
  const first = await engine.syncLiveJournal(snapshot, build, 100_000);
  const second = await engine.syncLiveJournal(snapshot, build, 100_100);
  assert.equal(first.exclusionsByReason.PRE_PROSPECTIVE_PERIOD, 1);
  assert.equal(second.exclusionsByReason.PRE_PROSPECTIVE_PERIOD, 1);
});

test('Phase 4 evidence bundle is canonical, complete and checksum-verifiable', async () => {
  const { engine, snapshot } = await startedEngine();
  withEpisode(snapshot, 100, 12_000, 'CORRECT');
  await engine.syncLiveJournal(snapshot, build, 100_000);
  const bundle = await engine.evidenceBundle(123_456);
  assert.equal(bundle.acceptedEpisodes.length, 1);
  assert.ok(bundle.auditEvents.length >= 4);
  const body = { report: bundle.report, experiment: bundle.experiment, acceptedEpisodes: bundle.acceptedEpisodes, importedDatasets: bundle.importedDatasets, exclusions: bundle.exclusions, auditEvents: bundle.auditEvents, evaluations: bundle.evaluations };
  assert.equal(bundle.manifest.bodyChecksumSha256, sha256(new TextEncoder().encode(canonicalJson(body))));
  const { evidenceBundleId: _id, ...manifestBase } = bundle.manifest;
  assert.equal(bundle.manifest.evidenceBundleId, canonicalEntityHash('PHASE4_EVIDENCE_BUNDLE', 1, manifestBase));
});


test('fixed-N boundary caps live batch at exactly 500 and excludes overflow', async () => {
  const { engine, snapshot } = await startedEngine();
  for (let index = 0; index < 495; index += 1) withEpisode(snapshot, index + 1, 20_000 + index * 70_000, 'CORRECT');
  await engine.syncLiveJournal(snapshot, build, 100_000_000);
  for (let index = 495; index < 505; index += 1) withEpisode(snapshot, index + 1, 20_000 + index * 70_000, 'CORRECT');
  const report = await engine.syncLiveJournal(snapshot, build, 200_000_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 500);
  assert.equal(report.correct, 500);
  assert.equal(report.exclusionsByReason.POST_CONFIRMATORY_PERIOD, 5);
  assert.equal(report.confirmatoryEvaluation?.confirmatorySampleSize, 500);
});

test('fixed-N boundary caps 499 plus ten at exactly 500', async () => {
  const { engine, snapshot } = await startedEngine();
  for (let index = 0; index < 499; index += 1) withEpisode(snapshot, index + 1, 20_000 + index * 70_000, 'CORRECT');
  await engine.syncLiveJournal(snapshot, build, 100_000_000);
  for (let index = 499; index < 509; index += 1) withEpisode(snapshot, index + 1, 20_000 + index * 70_000, 'INCORRECT');
  const report = await engine.syncLiveJournal(snapshot, build, 200_000_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 500);
  assert.equal(report.correct, 499);
  assert.equal(report.incorrect, 1);
  assert.equal(report.exclusionsByReason.POST_CONFIRMATORY_PERIOD, 9);
});

test('fixed-N boundary caps dataset import crossing 500', async () => {
  const { engine, snapshot } = await startedEngine();
  for (let index = 0; index < 499; index += 1) withEpisode(snapshot, index + 1, 20_000 + index * 70_000, 'CORRECT');
  await engine.syncLiveJournal(snapshot, build, 100_000_000);
  const imported = emptySnapshot();
  for (let index = 499; index < 509; index += 1) withEpisode(imported, index + 1, 20_000 + index * 70_000, 'INCORRECT');
  const report = await engine.importDatasetJson(JSON.stringify(datasetFrom(imported, 'frozen-config', 200_000_000)), 200_000_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 500);
  assert.equal(report.exclusionsByReason.POST_CONFIRMATORY_PERIOD, 9);
});

test('raw tick anchoring rejects tampered entry and exit evidence', async () => {
  const first = await startedEngine();
  withEpisode(first.snapshot, 700, 20_000, 'CORRECT');
  first.snapshot.ticks = first.snapshot.ticks.filter((item) => !item.tickId.startsWith('tick-decision-700'));
  let report = await first.engine.syncLiveJournal(first.snapshot, build, 100_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 0);
  assert.equal(report.exclusionsByReason.RAW_TICK_ANCHOR_MISMATCH, 1);

  const second = await startedEngine(30_000);
  withEpisode(second.snapshot, 701, 40_000, 'CORRECT');
  const exitTick = second.snapshot.ticks.find((item) => item.tickId === 'exit-signal-701');
  if (!exitTick) throw new Error('exit tick missing');
  exitTick.price += 0.0001;
  report = await second.engine.syncLiveJournal(second.snapshot, build, 200_000);
  assert.equal(report.prospectiveUniqueStrictEpisodes, 0);
  assert.equal(report.exclusionsByReason.RAW_TICK_ANCHOR_MISMATCH, 1);
});

test('historical invalidated experiments survive a fresh repository', async () => {
  const { engine } = await startedEngine();
  const report = await engine.report();
  assert.equal(report.historicalInvalidatedExperiments.length, 2);
  const first = report.historicalInvalidatedExperiments.find((item) => item.experimentId === 'P4-EURUSDOTC-V182-001');
  const second = report.historicalInvalidatedExperiments.find((item) => item.experimentId === 'P4-EURUSDOTC-V182-002');
  assert.equal(first?.correct, 3);
  assert.equal(first?.incorrect, 7);
  assert.ok(/VALIDATION_AUTHORITY_NOT_FULLY_FROZEN/.test(first?.invalidationDetail ?? ''));
  assert.equal(second?.correct, 4);
  assert.equal(second?.incorrect, 6);
  assert.ok(/FIXED_N_BATCH_BOUNDARY_DEFECT/.test(second?.invalidationDetail ?? ''));
});

test('full source tree is frozen for live collection and dataset import', async () => {
  const live = await startedEngine();
  let report = await live.engine.syncLiveJournal(live.snapshot, { ...build, sourceTreeSha256: 'f'.repeat(64) }, 100_000);
  assert.equal(report.status, 'INVALIDATED');

  const imported = await startedEngine(20_000);
  const snapshot = emptySnapshot();
  withEpisode(snapshot, 110, 21_000, 'CORRECT');
  const dataset = datasetFrom(snapshot, 'frozen-config', 300_000);
  dataset.manifest.sourceTreeSha256 = 'f'.repeat(64);
  const { datasetId: _id, ...manifestBase } = dataset.manifest;
  dataset.manifest.datasetId = canonicalEntityHash('DATASET', 10, manifestBase);
  await expectRejects(() => imported.engine.importDatasetJson(JSON.stringify(dataset), 300_000), /source tree/i);
});
