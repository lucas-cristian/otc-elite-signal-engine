import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  isSafeShadowReplayPacket,
  isValidShadowAuthPacket,
  isValidShadowEndpoint,
  SHADOW_NAMESPACE_REJECT_LIMIT,
  shadowReconnectDelayMs,
} from '../src/common/protocol/shadow-market-policy.js';

test('MAIN world shadow policy accepts only captured market-safe packets', () => {
  assert.equal(isSafeShadowReplayPacket('42["changeSymbol",{"asset":"EURUSD_otc","period":60}]', 'changeSymbol'), true);
  assert.equal(isSafeShadowReplayPacket('42["subfor","EURUSD_otc"]', 'subfor'), true);
  assert.equal(isSafeShadowReplayPacket('42["subscribeSymbol","EURUSD_otc"]', 'subscribeSymbol'), true);
  assert.equal(isSafeShadowReplayPacket('42["subscribeSymbol","EURUSD"]', 'subscribeSymbol'), false);
  assert.equal(isSafeShadowReplayPacket('42["ps"]', 'ps'), true);
  assert.equal(isSafeShadowReplayPacket('42["openOrder",{"asset":"EURUSD_otc"}]', 'openOrder'), false);
  assert.equal(isValidShadowAuthPacket('42["auth",{"session":"ephemeral"}]'), true);
  assert.equal(isValidShadowAuthPacket('42["openOrder",{}]'), false);
});

test('shadow backoff is monotonic and capped at twenty seconds', () => {
  assert.deepEqual([0,1,2,3,4,5,20].map(shadowReconnectDelayMs), [1000,2000,5000,10000,20000,20000,20000]);
  assert.equal(SHADOW_NAMESPACE_REJECT_LIMIT, 5);
});

test('shadow endpoint is limited to Pocket Option Engine.IO websocket transport', () => {
  assert.equal(isValidShadowEndpoint('wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket'), true);
  assert.equal(isValidShadowEndpoint('wss://example.com/socket.io/?EIO=4&transport=websocket'), false);
  assert.equal(isValidShadowEndpoint('https://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket'), false);
});
