import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isCompatibleMarketSource } from '../src/common/models/market-source-identity.js';
import type { MarketSourceIdentity } from '../src/common/models/types.js';
import { TIMEFRAME_MS } from '../src/common/time/candle-time.js';
import { rsiWilder, ema, atr, stochastic, bollingerZ } from '../src/service-worker/engine/indicators.js';

function identity(overrides: Partial<MarketSourceIdentity> = {}): MarketSourceIdentity {
  return {
    marketSourceIdentitySchemaVersion: '2',
    platform: 'POCKET_OPTION',
    canonicalAssetId: 'EURUSDOTC',
    marketType: 'OTC',
    source: 'POCKET_OPTION_WS_JSON',
    feedId: null,
    instrumentId: 'EURUSD_otc',
    parserSchemaId: 'POCKET_OPTION_SOCKETIO_DIRECT_V1',
    ...overrides,
  };
}

test('market source compatibility fails closed on asymmetric critical identity', () => {
  assert.deepEqual(isCompatibleMarketSource(identity({ feedId: 'feed-a' }), identity()), { compatible: false, reason: 'INSUFFICIENT_IDENTITY' });
  assert.deepEqual(isCompatibleMarketSource(identity(), identity({ instrumentId: 'GBPUSD_otc' })), { compatible: false, reason: 'INSTRUMENT_MISMATCH' });
  assert.deepEqual(isCompatibleMarketSource(identity(), identity()), { compatible: true, reason: 'MATCH' });
});

test('scientific timeframes are exactly 5s 10s 15s 30s 60s', () => {
  assert.deepEqual(TIMEFRAME_MS, { '5s': 5000, '10s': 10000, '15s': 15000, '30s': 30000, '60s': 60000 });
});

test('indicator warmup is null and flat RSI after warmup is 50', () => {
  assert.equal(rsiWilder([1, 1, 1], 14), null);
  assert.equal(rsiWilder(Array.from({ length: 15 }, () => 10), 14), 50);
  assert.equal(ema([1, 2], 5), null);
  assert.equal(atr([1,2], [0,1], [0.5,1.5], 14), null);
  assert.equal(stochastic([1,2], [0,1], [0.5,1.5], 14), null);
  assert.equal(bollingerZ([1,2], 20), null);
});
