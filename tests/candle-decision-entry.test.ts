import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CandleBuilder } from '../src/service-worker/engine/candle-builder.js';
import type { MarketSourceIdentity, Tick } from '../src/common/models/types.js';
import { DecisionEngine } from '../src/service-worker/engine/decision/decision-engine.js';
import { EntryResolver } from '../src/service-worker/engine/decision/entry-resolver.js';
import type { DecisionRecord, FeatureSnapshot } from '../src/common/models/journal-types.js';

const source: MarketSourceIdentity = {
  marketSourceIdentitySchemaVersion: '2', platform: 'POCKET_OPTION', canonicalAssetId: 'EURUSDOTC', marketType: 'OTC',
  source: 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON', feedId: 'demo-api-eu.po.market', instrumentId: 'EURUSD_otc', parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1',
};

function tick(ts: number, price: number, seq: number): Tick {
  return {
    tickSchemaVersion: '4', tickId: `t${seq}`, marketSourceIdentity: source, pageSessionId: 's1', connectionId: 'c1', sequence: seq,
    sourceTimestampEpochMs: ts, receivedAtEpochMs: ts + 5, receivedAtMonotonicMs: seq, eventTimestampEpochMs: ts,
    timestampBasis: 'SOURCE', sourceClockSynchronized: true, observedTimestampDeltaMs: 5, transportLatencyMs: null, price, integrity: 'VALID', sourceQuality: 'VERIFIED', protocolVerificationId: 'TEST_VERIFIED_STREAM',
  };
}

test('candle gaps produce null OHLC and never carry prices forward', () => {
  const emitted: ReturnType<CandleBuilder['partial']>[] = [];
  const builder = new CandleBuilder('EURUSDOTC', 'demo-api-eu.po.market', 'epoch-1', '5s', (candle) => emitted.push(candle));
  builder.ingest(tick(0, 10, 0));
  builder.ingest(tick(15_000, 11, 1));
  const nonNull = emitted.filter((value): value is NonNullable<typeof value> => value !== null);
  assert.equal(nonNull.length, 3);
  assert.equal(nonNull[0]?.close, 10);
  assert.equal(nonNull[1]?.lifecycle, 'EMPTY_INTERVAL');
  assert.equal(nonNull[1]?.open, null);
  assert.equal(nonNull[2]?.lifecycle, 'EMPTY_INTERVAL');
  assert.equal(nonNull[2]?.close, null);
});

test('decision keeps calibratedProbability null and blocks degraded data', () => {
  const engine = new DecisionEngine({ executionMode: 'LIVE', appVersion: '1', configHash: 'cfg', configSnapshot: {}, expirationSeconds: 60, minModelScore: 0.1 });
  const features: FeatureSnapshot = {
    featureSchemaVersion: '2', computedAt: 100, informationCutoffTimestamp: 100, usedPartialCandle: false, partialCandleCutoffTimestamp: null,
    features: { momentum3: 1, tickImbalance: 1, trendStrength: 1, persistence: 1, volatility: 0.001, expansion: 0 },
  };
  const decision = engine.evaluate({
    canonicalAssetId: 'EURUSDOTC', feedEpochId: 'epoch-1', timeframe: '5s', candleStartTimestamp: 0, candleEndTimestamp: 5000, computedAt: 5001,
    features, regime: { structure: 'TREND_UP', volatility: 'NORMAL' }, eventIntegrity: 'VALID', operationalDataState: 'DEGRADED', sourceQuality: 'VERIFIED', sourceFeedId: 'demo-api-eu.po.market', sourceProtocolVerificationId: 'TEST_VERIFIED_STREAM',
  });
  assert.equal(decision.calibratedProbability, null);
  assert.equal(decision.finalDecision, 'NO_TRADE');
  assert.ok(decision.blockers.includes('DATA_STATE_DEGRADED'));
});

test('entry resolver never uses a tick observed before alert publication', () => {
  const decision: DecisionRecord = {
    decisionSchemaVersion: '5', decisionId: 'd1', decisionGranularityKey: 'g1', executionMode: 'LIVE', canonicalAssetId: 'EURUSDOTC', feedEpochId: 'epoch-1', timeframe: '5s',
    decisionComputedAt: 1000, decisionPublishedAt: 1000, alertPublishedAt: 1000, evaluationWindowId: 'e1', candleStartTimestamp: 0,
    candidateDirection: 'CALL', finalDecision: 'CALL', modelScore: 0.8, calibratedProbability: null, structureRegime: 'TREND_UP', volatilityRegime: 'NORMAL',
    strategySnapshots: [], featureSnapshot: null, evidenceSnapshot: null, sourceQuality: 'VERIFIED', sourceFeedId: 'demo-api-eu.po.market', sourceProtocolVerificationId: 'TEST_VERIFIED_STREAM', eventIntegrity: 'VALID', operationalDataState: 'HEALTHY', blockers: [],
    expirationSeconds: 60, configHash: 'cfg', configSnapshot: {}, appVersion: '1', marketEpisodeId: 'episode-1', arbitrationStatus: 'PRIMARY', createdAt: 1000,
  };
  const resolver = new EntryResolver(3000);
  assert.equal(resolver.resolveFromTick(decision, tick(999, 10, 1), null), null);
  const resolved = resolver.resolveFromTick(decision, tick(1001, 10.1, 2), null);
  assert.ok(resolved);
  assert.equal(resolved.entry.resolutionStatus, 'RESOLVED');
  assert.equal(resolved.signal?.referenceEntryTimestamp, 1001);
});


test('unverified protocol schema fails closed before CALL or PUT', () => {
  const engine = new DecisionEngine({ executionMode: 'LIVE', appVersion: '1', configHash: 'cfg', configSnapshot: {}, expirationSeconds: 60, minModelScore: 0.1 });
  const features: FeatureSnapshot = {
    featureSchemaVersion: '2', computedAt: 100, informationCutoffTimestamp: 100, usedPartialCandle: false, partialCandleCutoffTimestamp: null,
    features: { momentum3: 1, tickImbalance: 1, trendStrength: 1, persistence: 1, volatility: 0.001, expansion: 0 },
  };
  const decision = engine.evaluate({
    canonicalAssetId: 'EURUSDOTC', feedEpochId: 'epoch-1', timeframe: '5s', candleStartTimestamp: 0, candleEndTimestamp: 5000, computedAt: 5001,
    features, regime: { structure: 'TREND_UP', volatility: 'NORMAL' }, eventIntegrity: 'VALID', operationalDataState: 'HEALTHY', sourceQuality: 'INFERRED', sourceFeedId: 'demo-api-eu.po.market', sourceProtocolVerificationId: null,
  });
  assert.equal(decision.finalDecision, 'NO_TRADE');
  assert.ok(decision.blockers.includes('UNVERIFIED_SOURCE_SCHEMA'));
});
