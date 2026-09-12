import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { SignalRecord } from '../src/common/models/journal-types.js';
import type { MarketSourceIdentity, Tick } from '../src/common/models/types.js';
import { DEFAULT_PIPELINE_CONFIG, QuantPipeline } from '../src/service-worker/core/quant-pipeline.js';
import { isSafeShadowReplayPacket } from '../src/common/protocol/shadow-market-policy.js';
import { MemoryJournal } from '../src/service-worker/storage/memory-journal.js';

const identity: MarketSourceIdentity = {
  marketSourceIdentitySchemaVersion: '2',
  platform: 'POCKET_OPTION',
  canonicalAssetId: 'EURUSDOTC',
  marketType: 'OTC',
  source: 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON',
  feedId: 'demo-api-eu.po.market',
  instrumentId: 'EURUSD_otc',
  parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1',
};

function tick(at: number, sequence: number, connectionId = 'ws-a', pageSessionId = 'page-a'): Tick {
  return {
    tickSchemaVersion: '4',
    tickId: `${connectionId}-${sequence}-${at}`,
    marketSourceIdentity: identity,
    pageSessionId,
    connectionId,
    sequence,
    sourceTimestampEpochMs: at + 7_200_000,
    receivedAtEpochMs: at,
    receivedAtMonotonicMs: sequence,
    eventTimestampEpochMs: at,
    timestampBasis: 'LOCAL_RECEIPT',
    sourceClockSynchronized: false,
    observedTimestampDeltaMs: -7_200_000,
    transportLatencyMs: null,
    price: 1.1 + Math.sin(sequence / 4) * 0.0002 + sequence * 0.000001,
    integrity: 'VALID',
    sourceQuality: 'VERIFIED',
    protocolVerificationId: 'TEST_VERIFIED_STREAM',
  };
}

function pendingSignal(): SignalRecord {
  return {
    signalSchemaVersion: '4',
    signalId: 'continuity-signal',
    signalFingerprint: 'continuity-fingerprint',
    decisionId: 'continuity-decision',
    marketEpisodeId: 'continuity-episode',
    feedEpochId: 'epoch-existing',
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
      feedId: 'demo-api-eu.po.market',
      parserSchemaId: 'POCKET_OPTION_SOCKETIO_BINARY_CHAFOR_V1',
      protocolVerificationId: 'TEST_VERIFIED_PAYOUT',
    },
    signalCreatedAt: 1_000,
  };
}

test('shadow connection replays only market subscription packets and never trade packets', () => {
  assert.equal(isSafeShadowReplayPacket('42["changeSymbol",{"asset":"EURUSD_otc","period":60}]', 'changeSymbol'), true);
  assert.equal(isSafeShadowReplayPacket('42["subfor","EURUSD_otc"]', 'subfor'), true);
  assert.equal(isSafeShadowReplayPacket('42["subscribeSymbol","EURUSD_otc"]', 'subscribeSymbol'), true);
  assert.equal(isSafeShadowReplayPacket('42["subscribeSymbol","EURUSD"]', 'subscribeSymbol'), false);
  assert.equal(isSafeShadowReplayPacket('42["ps"]', 'ps'), true);
  assert.equal(isSafeShadowReplayPacket('42["openOrder",{"asset":"EURUSD_otc","amount":100,"action":"call","time":60}]', 'openOrder'), false);
  assert.equal(isSafeShadowReplayPacket('42["auth",{"session":"secret"}]', 'auth'), false);
});

test('a long tick gap starts a new feed epoch and forces fresh warmup', async () => {
  const journal = new MemoryJournal();
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(0);
  for (let index = 0; index < 40; index++) await pipeline.enqueue({ tick: tick(1_000 + index * 1_000, index) });
  await pipeline.drain();
  const before = await journal.snapshot();
  const firstEpoch = before.continuityEvents.find((event) => event.eventType === 'EPOCH_STARTED')?.feedEpochId;
  assert.ok(firstEpoch);

  const resumedAt = 70_000;
  await pipeline.enqueue({ tick: tick(resumedAt, 100) });
  for (let index = 1; index <= 18; index++) await pipeline.enqueue({ tick: tick(resumedAt + index * 1_000, 100 + index) });
  await pipeline.drain();
  const after = await journal.snapshot();
  const gaps = after.continuityEvents.filter((event) => event.eventType === 'GAP_DETECTED');
  const epochs = after.continuityEvents.filter((event) => event.eventType === 'EPOCH_STARTED');
  assert.equal(gaps.length, 1);
  assert.equal(epochs.length, 2);
  assert.notEqual(epochs[0]?.feedEpochId, epochs[1]?.feedEpochId);
  const resumedEpoch = epochs[1]?.feedEpochId;
  assert.ok(resumedEpoch);
  const firstRecoveredCandle = after.candles
    .filter((candle) => candle.feedEpochId === resumedEpoch && candle.lifecycle === 'CLOSED')
    .sort((a, b) => a.endTimestamp - b.endTimestamp)[0];
  assert.ok(firstRecoveredCandle);
  assert.equal(firstRecoveredCandle.quality, 'GAP_AFFECTED');
  const earlyDecisions = after.decisions.filter((decision) => decision.feedEpochId === resumedEpoch && decision.createdAt <= resumedAt + 18_000);
  assert.equal(earlyDecisions.some((decision) => decision.finalDecision === 'CALL' || decision.finalDecision === 'PUT'), false);
  assert.equal(earlyDecisions.some((decision) => decision.blockers.includes('CORE_WARMUP')), true);
});

test('short reconnect gap preserves feed epoch and pending result', async () => {
  const journal = new MemoryJournal();
  await journal.appendTick(tick(1_000, 1));
  await journal.appendSignal(pendingSignal());
  await journal.appendContinuityEvent({
    feedContinuityEventSchemaVersion: '2',
    continuityEventId: 'epoch-start',
    canonicalAssetId: 'EURUSDOTC',
    feedId: 'demo-api-eu.po.market',
    feedEpochId: 'epoch-existing',
    eventType: 'EPOCH_STARTED',
    occurredAt: 1_000,
    connectionId: 'ws-a',
    previousConnectionId: 'ws-a',
    pageSessionId: 'page-a',
    gapMs: null,
    reason: 'TEST',
  });
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(1_100);
  await pipeline.connectionLost('ws-a', 2_000, 'SHADOW_WS_CLOSE');
  await pipeline.drain();

  let snapshot = await journal.snapshot();
  assert.equal(snapshot.results.some((item) => item.signalId === 'continuity-signal'), false);
  assert.equal(snapshot.continuityEvents.some((event) => event.eventType === 'EPOCH_ENDED'), false);

  await pipeline.enqueue({ tick: tick(6_000, 2, 'ws-b', 'page-a') });
  await pipeline.drain();
  snapshot = await journal.snapshot();

  const epochs = snapshot.continuityEvents.filter((event) => event.eventType === 'EPOCH_STARTED');
  assert.equal(epochs.length, 1);
  const shortGap = snapshot.continuityEvents.find((event) => event.eventType === 'SHORT_RECONNECT_GAP');
  assert.ok(shortGap);
  assert.equal(shortGap.feedEpochId, 'epoch-existing');
  assert.equal(shortGap.previousConnectionId, 'ws-a');
  assert.equal(shortGap.connectionId, 'ws-b');
  assert.equal(shortGap.gapMs, 5_000);
  assert.equal(snapshot.results.some((item) => item.signalId === 'continuity-signal'), false);
  assert.notEqual(pipeline.getAssetFeedOperationalHealth('EURUSDOTC', 'demo-api-eu.po.market', 6_001).state, 'DATA_UNAVAILABLE');
});


test('short transport switch marks only boundary candles gap-affected without creating a new epoch', async () => {
  const journal = new MemoryJournal();
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(0);

  for (let index = 0; index < 36; index++) {
    await pipeline.enqueue({ tick: tick(1_000 + index * 1_000, index, 'shadow-main-1') });
  }
  await pipeline.connectionLost('shadow-main-1', 36_500, 'SHADOW_WS_CLOSE');
  await pipeline.enqueue({ tick: tick(41_000, 100, 'shadow-main-2') });
  for (let index = 1; index <= 12; index++) {
    await pipeline.enqueue({ tick: tick(41_000 + index * 1_000, 100 + index, 'shadow-main-2') });
  }
  await pipeline.drain();

  const snapshot = await journal.snapshot();
  assert.equal(snapshot.continuityEvents.filter((event) => event.eventType === 'EPOCH_STARTED').length, 1);
  const shortGap = snapshot.continuityEvents.find((event) => event.eventType === 'SHORT_RECONNECT_GAP');
  assert.ok(shortGap);
  assert.equal(shortGap.gapMs, 5_000);
  assert.equal(shortGap.previousConnectionId, 'shadow-main-1');
  assert.equal(shortGap.connectionId, 'shadow-main-2');

  const affected = snapshot.candles.filter((candle) => candle.quality === 'GAP_AFFECTED');
  assert.ok(affected.length > 0);
  const cleanAfterRecovery = snapshot.candles.filter(
    (candle) => candle.timeframe === '5s' && candle.lifecycle === 'CLOSED' && candle.startTimestamp >= 45_000 && candle.quality === 'CLEAN',
  );
  assert.ok(cleanAfterRecovery.length > 0);
});

test('connection loss exceeding grace ends the feed epoch and invalidates pending result', async () => {
  const journal = new MemoryJournal();
  await journal.appendTick(tick(1_000, 1));
  await journal.appendSignal(pendingSignal());
  await journal.appendContinuityEvent({
    feedContinuityEventSchemaVersion: '2',
    continuityEventId: 'epoch-start-long-loss',
    canonicalAssetId: 'EURUSDOTC',
    feedId: 'demo-api-eu.po.market',
    feedEpochId: 'epoch-existing',
    eventType: 'EPOCH_STARTED',
    occurredAt: 1_000,
    connectionId: 'ws-a',
    previousConnectionId: 'ws-a',
    pageSessionId: 'page-a',
    gapMs: null,
    reason: 'TEST',
  });
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(1_100);
  await pipeline.connectionLost('ws-a', 2_000, 'SHADOW_WS_CLOSE');
  await pipeline.watchdog(16_100);
  await pipeline.drain();

  const snapshot = await journal.snapshot();
  const result = snapshot.results.find((item) => item.signalId === 'continuity-signal');
  assert.ok(result && result.resolutionStatus === 'UNRESOLVED');
  assert.equal(result.unresolvedReason, 'ASSET_FEED_LOST');
  assert.equal(snapshot.continuityEvents.some((event) => event.eventType === 'EPOCH_ENDED'), true);
  assert.equal(pipeline.getAssetFeedOperationalHealth('EURUSDOTC', 'demo-api-eu.po.market', 16_101).state, 'DATA_UNAVAILABLE');
});

test('captured-style source switch after a multi-minute outage records the gap and blocks immediate signals', async () => {
  const journal = new MemoryJournal();
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(0);
  const base = 1_000;
  for (let index = 0; index < 40; index++) await pipeline.enqueue({ tick: tick(base + index * 1_000, index, 'ws-3') });
  await pipeline.drain();
  const lastBeforeGap = base + 39_000;
  const resumedAt = lastBeforeGap + 281_928;
  await pipeline.enqueue({ tick: tick(resumedAt, 0, 'ws-4') });
  for (let index = 1; index <= 24; index++) await pipeline.enqueue({ tick: tick(resumedAt + index * 1_000, index, 'ws-4') });
  await pipeline.drain();

  const snapshot = await journal.snapshot();
  const sourceSwitch = snapshot.continuityEvents.find((event) => event.eventType === 'SOURCE_SWITCH');
  assert.ok(sourceSwitch);
  assert.equal(sourceSwitch.previousConnectionId, 'ws-3');
  assert.equal(sourceSwitch.connectionId, 'ws-4');
  assert.equal(sourceSwitch.gapMs, 281_928);
  const recoveredEpoch = snapshot.continuityEvents
    .filter((event) => event.eventType === 'EPOCH_STARTED')
    .sort((a, b) => a.occurredAt - b.occurredAt)[1]?.feedEpochId;
  assert.ok(recoveredEpoch);
  const recoveredCandles = snapshot.candles
    .filter((candle) => candle.feedEpochId === recoveredEpoch && candle.lifecycle === 'CLOSED')
    .sort((a, b) => a.endTimestamp - b.endTimestamp);
  assert.ok(recoveredCandles.length > 0);
  assert.equal(recoveredCandles[0]?.quality, 'GAP_AFFECTED');
  const immediateSignals = snapshot.signals.filter((signal) => signal.feedEpochId === recoveredEpoch && signal.signalCreatedAt < resumedAt + 25_000);
  assert.equal(immediateSignals.length, 0);
});
