import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { sha256 } from '../src/common/hashing/sha256.js';
import { canonicalEntityHash, canonicalJson } from '../src/common/hashing/canonical-hash.js';
import { parsePocketOptionProductionFrame } from '../src/common/protocol/pocket-option-parser.js';
import { createValidatedTick } from '../src/common/validation/tick-factory.js';

const encoder = new TextEncoder();

test('sha256 matches known vector and canonical JSON is order-independent', () => {
  assert.equal(sha256(encoder.encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(canonicalEntityHash('X', 1, { b: 2, a: 1 }), canonicalEntityHash('X', 1, { a: 1, b: 2 }));
  assert.throws(() => canonicalJson({ bad: Number.NaN }), /Non-finite/);
});

test('production parser rejects unknown frames and parses only versioned schemas', () => {
  const context = { connectionId: 'ws-1', sequence: 7, receivedAtEpochMs: 1_700_000_000_000, receivedAtMonotonicMs: 123.4 };
  assert.equal(parsePocketOptionProductionFrame('42["chat",{"symbol":"EURUSD_otc","price":1.2}]', context), null);
  assert.equal(parsePocketOptionProductionFrame('not-socket-io', context), null);
  const direct = parsePocketOptionProductionFrame('42["update",{"symbol":"EURUSD_otc","price":1.075,"timestampMs":1700000000000}]', context);
  assert.ok(direct);
  assert.equal(direct.identity.canonicalAssetId, 'EURUSDOTC');
  assert.equal(direct.identity.parserSchemaId, 'POCKET_OPTION_SOCKETIO_DIRECT_V1');
  assert.equal(direct.sourceTimestampEpochMs, 1_700_000_000_000);
  const stream = parsePocketOptionProductionFrame('42["updateStream",{"symbol":"EURUSD_otc","data":[[1700000000,1.076]]}]', context);
  assert.ok(stream);
  assert.equal(stream.sourceTimestampEpochMs, 1_700_000_000_000);
});

test('tick identity is deterministic and preserves clock domains', () => {
  const event = parsePocketOptionProductionFrame(
    '42["update",{"symbol":"EURUSD_otc","price":1.075,"timestampMs":1700000000000}]',
    { connectionId: 'ws-1', sequence: 2, receivedAtEpochMs: 1_700_000_000_025, receivedAtMonotonicMs: 500.25 },
  );
  assert.ok(event);
  const first = createValidatedTick(event, 'session-a');
  const second = createValidatedTick(event, 'session-a');
  assert.equal(first.tickId, second.tickId);
  assert.equal(first.sourceTimestampEpochMs, 1_700_000_000_000);
  assert.equal(first.receivedAtEpochMs, 1_700_000_000_025);
  assert.equal(first.receivedAtMonotonicMs, 500.25);
  assert.equal(first.observedTimestampDeltaMs, 25);
  assert.equal(first.transportLatencyMs, null);
});
