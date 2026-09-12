import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { sha256 } from '../src/common/hashing/sha256.js';
import { canonicalEntityHash, canonicalJson } from '../src/common/hashing/canonical-hash.js';
import { PocketOptionSocketIoDecoder } from '../src/common/protocol/pocket-option-parser.js';
import { createValidatedTick } from '../src/common/validation/tick-factory.js';
import type { SemanticPriceEvent } from '../src/common/protocol/market-events.js';

const encoder = new TextEncoder();
const demoEndpoint = 'wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket';
const realEndpoint = 'wss://api-us-north.po.market/socket.io/?EIO=4&transport=websocket';

function binaryJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

async function decodeStream(endpoint: string, connectionId = 'ws-1'): Promise<SemanticPriceEvent> {
  const decoder = new PocketOptionSocketIoDecoder(connectionId, endpoint);
  const timing = { receivedAtEpochMs: 1_789_223_779_543, receivedAtMonotonicMs: 123.4 };
  assert.deepEqual(await decoder.ingest('451-["updateStream",{"_placeholder":true,"num":0}]', timing), []);
  const events = await decoder.ingest(binaryJson([['EURUSD_otc', 1_789_230_979.343, 1.14361]]), timing);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.ok(event && event.type === 'SEMANTIC_PRICE');
  return event;
}

test('sha256 matches known vector and canonical JSON is order-independent', () => {
  assert.equal(sha256(encoder.encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(canonicalEntityHash('X', 1, { b: 2, a: 1 }), canonicalEntityHash('X', 1, { a: 1, b: 2 }));
  assert.throws(() => canonicalJson({ bad: Number.NaN }), /Non-finite/);
});

test('captured DEMO binary updateStream schema is parsed fail-closed and verified', async () => {
  const event = await decodeStream(demoEndpoint);
  assert.equal(event.sequence, 0);
  assert.equal(event.identity.canonicalAssetId, 'EURUSDOTC');
  assert.equal(event.identity.instrumentId, 'EURUSD_otc');
  assert.equal(event.identity.feedId, 'demo-api-eu.po.market');
  assert.equal(event.identity.parserSchemaId, 'POCKET_OPTION_SOCKETIO_BINARY_STREAM_V1');
  assert.equal(event.identity.source, 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON');
  assert.equal(event.sourceTimestampEpochMs, 1_789_230_979_343);
  assert.equal(event.sourceClockSynchronized, false);
  assert.equal(event.sourceQuality, 'VERIFIED');
});

test('captured real endpoint remains inferred even when the binary shape matches', async () => {
  const event = await decodeStream(realEndpoint);
  assert.equal(event.identity.feedId, 'api-us-north.po.market');
  assert.equal(event.sourceQuality, 'INFERRED');
});

test('semantic sequence has no gaps across ignored raw frames and separate binary events', async () => {
  const decoder = new PocketOptionSocketIoDecoder('ws-2', demoEndpoint);
  const timing = { receivedAtEpochMs: 1_789_223_780_000, receivedAtMonotonicMs: 200 };
  assert.deepEqual(await decoder.ingest('0{"sid":"x"}', timing), []);
  assert.deepEqual(await decoder.ingest('40', timing), []);
  assert.deepEqual(await decoder.ingest('451-["updateHistoryNewFast",{"_placeholder":true,"num":0}]', timing), []);
  assert.deepEqual(await decoder.ingest(binaryJson({ asset: 'EURUSD_otc', period: 60, history: [[1_789_230_900, 1.1]], candles: [] }), timing), []);
  assert.deepEqual(await decoder.ingest('451-["updateStream",{"_placeholder":true,"num":0}]', timing), []);
  const priceEvents = await decoder.ingest(binaryJson([['EURUSD_otc', 1_789_230_980, 1.14362]]), timing);
  assert.equal(priceEvents[0]?.sequence, 0);
  assert.deepEqual(await decoder.ingest('451-["chafor",{"_placeholder":true,"num":0}]', timing), []);
  const payoutEvents = await decoder.ingest(binaryJson([['EURUSD_otc', 96]]), timing);
  assert.equal(payoutEvents[0]?.sequence, 1);
  assert.equal(payoutEvents[0]?.type, 'SEMANTIC_PAYOUT');
  if (payoutEvents[0]?.type === 'SEMANTIC_PAYOUT') {
    assert.equal(payoutEvents[0].payoutSnapshot.payoutRate, 0.96);
    assert.equal(payoutEvents[0].payoutSnapshot.expirationSeconds, null);
    assert.equal(payoutEvents[0].payoutSnapshot.quality, 'VERIFIED');
  }
});

test('non-OTC rows and malformed binary packets are rejected', async () => {
  const decoder = new PocketOptionSocketIoDecoder('ws-3', demoEndpoint);
  const timing = { receivedAtEpochMs: 1_789_223_780_000, receivedAtMonotonicMs: 200 };
  await decoder.ingest('451-["updateStream",{"_placeholder":true,"num":0}]', timing);
  assert.deepEqual(await decoder.ingest(binaryJson([['AUDCAD', 1_789_230_980, 0.99]]), timing), []);
  await decoder.ingest('451-["updateStream",{"_placeholder":true,"num":0}]', timing);
  assert.deepEqual(await decoder.ingest(binaryJson([['EURUSD_otc', 'bad', 1.14]]), timing), []);
  assert.deepEqual(await decoder.ingest('42["updateStream",{}]', timing), []);
});

test('unsynchronized Pocket Option source clock is preserved but LOCAL_RECEIPT drives causal time', async () => {
  const event = await decodeStream(demoEndpoint);
  const first = createValidatedTick(event, 'session-a');
  const second = createValidatedTick(event, 'session-a');
  assert.equal(first.tickId, second.tickId);
  assert.equal(first.sourceTimestampEpochMs, 1_789_230_979_343);
  assert.equal(first.receivedAtEpochMs, 1_789_223_779_543);
  assert.equal(first.observedTimestampDeltaMs, -7_199_800);
  assert.equal(first.eventTimestampEpochMs, first.receivedAtEpochMs);
  assert.equal(first.timestampBasis, 'LOCAL_RECEIPT');
  assert.equal(first.sourceClockSynchronized, false);
  assert.equal(first.integrity, 'VALID');
  assert.equal(first.transportLatencyMs, null);
  assert.equal(first.sourceQuality, 'VERIFIED');
});
