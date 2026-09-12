import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DecisionRecord } from '../src/common/models/journal-types.js';
import type { MarketSourceIdentity, Tick } from '../src/common/models/types.js';
import { MarketEpisodeArbitrator } from '../src/service-worker/core/market-episode-arbitrator.js';
import { DEFAULT_PIPELINE_CONFIG, QuantPipeline } from '../src/service-worker/core/quant-pipeline.js';
import { MemoryJournal } from '../src/service-worker/storage/memory-journal.js';

function decision(id: string, timeframe: DecisionRecord['timeframe'], direction: 'CALL' | 'PUT', score: number, at = 10_000): DecisionRecord {
  return {
    decisionSchemaVersion: '4', decisionId: id, decisionGranularityKey: `g-${id}`, executionMode: 'LIVE', canonicalAssetId: 'EURUSDOTC', timeframe,
    decisionComputedAt: at, decisionPublishedAt: at, alertPublishedAt: at, evaluationWindowId: `w-${id}`, candleStartTimestamp: at - 5_000,
    candidateDirection: direction, finalDecision: direction, modelScore: score, calibratedProbability: null, structureRegime: 'TREND_UP', volatilityRegime: 'NORMAL',
    strategySnapshots: [], featureSnapshot: null, evidenceSnapshot: null, sourceQuality: 'VERIFIED', sourceFeedId: 'demo-api-eu.po.market',
    sourceProtocolVerificationId: 'VERIFIED', eventIntegrity: 'VALID', operationalDataState: 'HEALTHY', blockers: [], expirationSeconds: 60,
    configHash: 'cfg', configSnapshot: {}, appVersion: '1.5.0', marketEpisodeId: null, arbitrationStatus: 'NOT_APPLICABLE', createdAt: at,
  };
}

function identity(asset: string): MarketSourceIdentity {
  return {
    marketSourceIdentitySchemaVersion: '2', platform: 'POCKET_OPTION', canonicalAssetId: asset, marketType: 'OTC', source: 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON',
    feedId: 'demo-api-eu.po.market', instrumentId: asset === 'EURUSDOTC' ? 'EURUSD_otc' : 'EURJPY_otc', parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1',
  };
}

function tick(asset: string, at: number, sequence: number): Tick {
  return {
    tickSchemaVersion: '4', tickId: `${asset}-${at}`, marketSourceIdentity: identity(asset), pageSessionId: 'page', connectionId: 'ws', sequence,
    sourceTimestampEpochMs: at + 7_200_000, receivedAtEpochMs: at, receivedAtMonotonicMs: sequence, eventTimestampEpochMs: at,
    timestampBasis: 'LOCAL_RECEIPT', sourceClockSynchronized: false, observedTimestampDeltaMs: -7_200_000, transportLatencyMs: null,
    price: asset === 'EURUSDOTC' ? 1.1 : 175, integrity: 'VALID', sourceQuality: 'VERIFIED', protocolVerificationId: 'VERIFIED',
  };
}

test('multi-timeframe arbitration emits one primary decision and suppresses correlated candidates', () => {
  const arbitrator = new MarketEpisodeArbitrator({ conflictScoreMargin: 0.1, activeEpisodeHorizonMs: 68_000 });
  const output = arbitrator.arbitrate([
    decision('d5', '5s', 'CALL', 0.61),
    decision('d10', '10s', 'CALL', 0.72),
    decision('d15', '15s', 'CALL', 0.66),
  ], 10_000);
  const primary = output.filter((item) => item.arbitrationStatus === 'PRIMARY');
  assert.equal(primary.length, 1);
  assert.equal(primary[0]?.decisionId, 'd10');
  assert.equal(output.filter((item) => item.finalDecision === 'CALL').length, 1);
  assert.equal(new Set(output.map((item) => item.marketEpisodeId)).size, 1);
});

test('overlapping decisions stay in the active market episode instead of creating another signal', () => {
  const arbitrator = new MarketEpisodeArbitrator({ conflictScoreMargin: 0.1, activeEpisodeHorizonMs: 68_000 });
  const first = arbitrator.arbitrate([decision('d1', '5s', 'CALL', 0.8)], 10_000);
  assert.equal(first[0]?.arbitrationStatus, 'PRIMARY');
  const second = arbitrator.arbitrate([decision('d2', '5s', 'PUT', 0.95, 20_000)], 20_000);
  assert.equal(second[0]?.finalDecision, 'NO_TRADE');
  assert.equal(second[0]?.arbitrationStatus, 'SUPPRESSED_ACTIVE_EPISODE');
  assert.ok(second[0]?.blockers.includes('CORRELATED_ACTIVE_EPISODE'));
});

test('near-tied opposite directions fail closed as arbitration conflict', () => {
  const arbitrator = new MarketEpisodeArbitrator({ conflictScoreMargin: 0.1, activeEpisodeHorizonMs: 68_000 });
  const output = arbitrator.arbitrate([decision('call', '5s', 'CALL', 0.70), decision('put', '10s', 'PUT', 0.65)], 10_000);
  assert.equal(output.every((item) => item.finalDecision === 'NO_TRADE'), true);
  assert.equal(output.every((item) => item.arbitrationStatus === 'SUPPRESSED_CONFLICT'), true);
});

test('asset-feed watchdog keeps EURUSD healthy while EURJPY independently becomes unavailable', async () => {
  const journal = new MemoryJournal();
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(0);
  await pipeline.enqueue({ tick: tick('EURJPYOTC', 1_000, 1) });
  await pipeline.enqueue({ tick: tick('EURUSDOTC', 65_000, 2) });
  await pipeline.drain();
  assert.equal(pipeline.getAssetFeedOperationalHealth('EURUSDOTC', 'demo-api-eu.po.market', 65_500).state, 'HEALTHY');
  assert.equal(pipeline.getAssetFeedOperationalHealth('EURJPYOTC', 'demo-api-eu.po.market', 65_500).state, 'DATA_UNAVAILABLE');
});
