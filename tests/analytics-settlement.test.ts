import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DecisionRecord, ResolvedResultRecord, SignalRecord } from '../src/common/models/journal-types.js';
import type { MarketSourceIdentity } from '../src/common/models/types.js';
import type { JournalSnapshot } from '../src/service-worker/storage/journal-repository.js';
import { computeAnalytics } from '../src/service-worker/evaluation/analytics.js';

const source: MarketSourceIdentity = {
  marketSourceIdentitySchemaVersion: '2',
  platform: 'POCKET_OPTION',
  canonicalAssetId: 'EURUSDOTC',
  marketType: 'OTC',
  source: 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON',
  feedId: 'demo-api-eu.po.market',
  instrumentId: 'EURUSD_otc',
  parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1',
};

function decision(id: string, timeframe: '5s' | '10s'): DecisionRecord {
  return {
    decisionSchemaVersion: '5', decisionId: id, decisionGranularityKey: `g-${id}`, executionMode: 'LIVE', canonicalAssetId: 'EURUSDOTC', feedEpochId: 'epoch-1', timeframe,
    decisionComputedAt: 1_000, decisionPublishedAt: 1_000, alertPublishedAt: 1_000, evaluationWindowId: `w-${id}`, candleStartTimestamp: 0,
    candidateDirection: 'CALL', finalDecision: 'CALL', modelScore: 0.8, calibratedProbability: null, structureRegime: 'TREND_UP', volatilityRegime: 'NORMAL',
    strategySnapshots: [{ strategyId: 'MOMENTUM_V1', strategyVersion: '1', direction: 'CALL', rawScore: 0.8, evidence: [], blockers: [] }],
    featureSnapshot: null, evidenceSnapshot: null, sourceQuality: 'VERIFIED', sourceFeedId: source.feedId, sourceProtocolVerificationId: 'VERIFIED_STREAM', eventIntegrity: 'VALID', operationalDataState: 'HEALTHY', blockers: [],
    expirationSeconds: 60, configHash: 'cfg', configSnapshot: {}, appVersion: '1.8.2', marketEpisodeId: `episode-${id}`, arbitrationStatus: 'PRIMARY', createdAt: 1_000,
  };
}

function signal(id: string, decisionId: string): SignalRecord {
  return {
    signalSchemaVersion: '4', signalId: id, signalFingerprint: `fp-${id}`, decisionId, marketEpisodeId: `episode-${decisionId}`, feedEpochId: 'epoch-1', executionMode: 'LIVE', canonicalAssetId: 'EURUSDOTC', direction: 'CALL',
    referenceEntryPrice: 1.1, referenceEntryTimestamp: 1_000, expirationSeconds: 60, expectedExpiryTimestamp: 61_000, entryMarketSourceIdentity: source, entryPageSessionId: 'page-a',
    payoutSnapshot: { payoutSnapshotSchemaVersion: '3', canonicalAssetId: 'EURUSDOTC', expirationSeconds: null, expirationBinding: 'UNBOUND', payoutRate: 0.8, capturedAt: 900, source: 'PLATFORM_PROTOCOL', quality: 'VERIFIED', feedId: source.feedId, parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1', protocolVerificationId: 'VERIFIED_PAYOUT' },
    signalCreatedAt: 1_000,
  };
}

function result(signalId: string, timingErrorMs: number, directionalOutcome: 'CORRECT' | 'INCORRECT'): ResolvedResultRecord {
  return {
    resolutionStatus: 'RESOLVED', resultSchemaVersion: '3', resultId: `r-${signalId}`, signalId, evaluationMode: 'REFERENCE_FEED', referenceExitPrice: directionalOutcome === 'CORRECT' ? 1.2 : 1.0,
    referenceExitTimestamp: 61_000 + timingErrorMs, expiryTimingErrorMs: timingErrorMs, priceOutcome: directionalOutcome === 'CORRECT' ? 'UP' : 'DOWN', directionalOutcome,
    economicOutcome: 'UNKNOWN', economicReturn: null, economicEvaluationReason: 'PAYOUT_EXPIRATION_UNBOUND', settlementMetadata: { settlementMetadataSchemaVersion: '2', confidence: 'UNKNOWN', source: null, verifiedAt: null },
    exitMarketSourceIdentity: source, recoveredAcrossPageSession: false, entryPageSessionId: 'page-a', exitPageSessionId: 'page-a', evaluatedAt: 61_000 + timingErrorMs,
  };
}

test('analytics separates strict and relaxed settlement timing samples', () => {
  const snapshot: JournalSnapshot = {
    ticks: [], payoutSnapshots: [], candles: [],
    decisions: [decision('d1', '5s'), decision('d2', '10s')],
    entryResolutions: [], decisionSignalLinks: [],
    signals: [signal('s1', 'd1'), signal('s2', 'd2')],
    results: [result('s1', 200, 'CORRECT'), result('s2', 4_632, 'INCORRECT')],
    continuityEvents: [], transportEvents: [],
  };
  const health = { state: 'HEALTHY' as const, reason: 'FRESH' as const, assessedAt: 70_000, latestTickReceivedAt: 69_900, latestTickAgeMs: 100, thresholds: { degradedAfterMs: 5_000, staleAfterMs: 15_000, dataUnavailableAfterMs: 60_000 } };
  const capture = { transportSchemaVersion: '4' as const, tabId: null, pageSessionId: null, connected: true, visibility: 'hidden' as const, frozen: false, discarded: false, autoDiscardable: false, lastSemanticEventAt: 69_900, lastLifecycleEventAt: null, lastConnectionEventAt: null, lastLifecycleReason: null, shadowConnected: true, shadowPrimary: true, shadowState: 'STREAMING' as const, shadowEndpointHost: source.feedId, shadowReconnectAttempts: 0, shadowConsecutiveNamespaceRejects: 0, shadowCircuitOpen: false, shadowLastMessageAt: 69_900, shadowLastPriceAt: 69_900, shadowLastErrorReason: null, shadowLastCommandAt: null, mitigation: 'MAIN_WORLD_NATIVE_SHADOW_RUNTIME_PORT_WATCHDOG_AUTO_DISCARD_DISABLED' as const };
  const analytics = computeAnalytics(snapshot, health, [], capture, 0, 1_000, 5_000);

  assert.equal(analytics.strictResolvedDirectionalSampleSize, 1);
  assert.equal(analytics.strictDirectionalCorrectCount, 1);
  assert.equal(analytics.strictDirectionalAccuracy, 1);
  assert.equal(analytics.relaxedResolvedDirectionalSampleSize, 2);
  assert.equal(analytics.relaxedDirectionalCorrectCount, 1);
  assert.equal(analytics.relaxedDirectionalAccuracy, 0.5);
  assert.equal(analytics.directionalAccuracy, 0.5);
  assert.equal(analytics.strictTimeframePerformance[0]?.key, '5s');
  assert.equal(analytics.strictTimeframePerformance[0]?.accuracy, 1);
});
