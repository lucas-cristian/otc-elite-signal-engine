import { getCanonicalAssetId } from '../hashing/canonical-hash.js';
import type { MarketSourceIdentity, PayoutSnapshot } from '../models/types.js';
import type { SemanticPriceEvent } from './market-events.js';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface ParseContext {
  connectionId: string;
  sequence: number;
  receivedAtEpochMs: number;
  receivedAtMonotonicMs: number;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonValue(text: string): JsonValue | null {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
}

function unwrapSocketIoPayload(text: string): JsonValue[] | null {
  if (!text.startsWith('42[')) return null;
  const parsed = parseJsonValue(text.slice(2));
  return Array.isArray(parsed) ? parsed : null;
}

function finiteNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function identity(asset: string, payload: JsonObject, parserSchemaId: string): MarketSourceIdentity {
  const canonicalAssetId = getCanonicalAssetId(asset);
  const explicitInstrument = nonEmptyString(payload.instrumentId) ?? nonEmptyString(payload.symbol) ?? nonEmptyString(payload.asset);
  if (!explicitInstrument) throw new TypeError('Instrument identity is required');
  return {
    marketSourceIdentitySchemaVersion: '2',
    platform: 'POCKET_OPTION',
    canonicalAssetId,
    marketType: 'OTC',
    source: 'POCKET_OPTION_WS_JSON',
    feedId: nonEmptyString(payload.feedId),
    instrumentId: explicitInstrument,
    parserSchemaId,
  };
}

function payout(payload: JsonObject, canonicalAssetId: string, capturedAt: number): PayoutSnapshot | null {
  const raw = finiteNumber(payload.payout) ?? finiteNumber(payload.payoutRate);
  if (raw === null) return null;
  const payoutRate = raw > 1 ? raw / 100 : raw;
  if (payoutRate < 0 || payoutRate > 1) return null;
  return {
    payoutSnapshotSchemaVersion: '1',
    canonicalAssetId,
    expirationSeconds: 60,
    payoutRate,
    capturedAt,
    source: 'PLATFORM_PROTOCOL',
    quality: 'INFERRED',
  };
}

function plausibleEpochMs(value: number, receivedAtEpochMs: number): number | null {
  const maxDelta = 24 * 60 * 60 * 1000;
  return Math.abs(receivedAtEpochMs - value) <= maxDelta ? value : null;
}

function parseDirect(eventName: string, payload: JsonObject, context: ParseContext): SemanticPriceEvent | null {
  if (eventName !== 'update' && eventName !== 'price_update') return null;
  const asset = nonEmptyString(payload.asset) ?? nonEmptyString(payload.symbol);
  const price = finiteNumber(payload.price) ?? finiteNumber(payload.rate);
  if (!asset || price === null || price <= 0) return null;
  const sourceTimestamp = finiteNumber(payload.timestampMs);
  const sourceTimestampEpochMs = sourceTimestamp === null ? null : plausibleEpochMs(sourceTimestamp, context.receivedAtEpochMs);
  const marketIdentity = identity(asset, payload, 'POCKET_OPTION_SOCKETIO_DIRECT_V1');
  return {
    type: 'SEMANTIC_PRICE',
    connectionId: context.connectionId,
    sequence: context.sequence,
    identity: marketIdentity,
    price,
    sourceTimestampEpochMs,
    receivedAtEpochMs: context.receivedAtEpochMs,
    receivedAtMonotonicMs: context.receivedAtMonotonicMs,
    payoutSnapshot: payout(payload, marketIdentity.canonicalAssetId, context.receivedAtEpochMs),
  };
}

function parseStream(eventName: string, payload: JsonObject, context: ParseContext): SemanticPriceEvent | null {
  if (eventName !== 'updateStream') return null;
  const asset = nonEmptyString(payload.asset) ?? nonEmptyString(payload.symbol);
  const data = payload.data;
  if (!asset || !Array.isArray(data) || data.length === 0) return null;
  const last = data[data.length - 1];
  if (!Array.isArray(last) || last.length < 2) return null;
  const timestampSeconds = finiteNumber(last[0]);
  const price = finiteNumber(last[1]);
  if (timestampSeconds === null || price === null || price <= 0) return null;
  const sourceTimestampEpochMs = plausibleEpochMs(timestampSeconds * 1000, context.receivedAtEpochMs);
  if (sourceTimestampEpochMs === null) return null;
  const marketIdentity = identity(asset, payload, 'POCKET_OPTION_SOCKETIO_STREAM_V1');
  return {
    type: 'SEMANTIC_PRICE',
    connectionId: context.connectionId,
    sequence: context.sequence,
    identity: marketIdentity,
    price,
    sourceTimestampEpochMs,
    receivedAtEpochMs: context.receivedAtEpochMs,
    receivedAtMonotonicMs: context.receivedAtMonotonicMs,
    payoutSnapshot: payout(payload, marketIdentity.canonicalAssetId, context.receivedAtEpochMs),
  };
}

function parseHistory(eventName: string, payload: JsonObject, context: ParseContext): SemanticPriceEvent | null {
  if (eventName !== 'updateHistoryNew') return null;
  const asset = nonEmptyString(payload.asset) ?? nonEmptyString(payload.symbol);
  const history = payload.history;
  if (!asset || !Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (!Array.isArray(last) || last.length < 2) return null;
  const timestampSeconds = finiteNumber(last[0]);
  const price = finiteNumber(last[1]);
  if (timestampSeconds === null || price === null || price <= 0) return null;
  const sourceTimestampEpochMs = plausibleEpochMs(timestampSeconds * 1000, context.receivedAtEpochMs);
  if (sourceTimestampEpochMs === null) return null;
  const marketIdentity = identity(asset, payload, 'POCKET_OPTION_SOCKETIO_HISTORY_V1');
  return {
    type: 'SEMANTIC_PRICE',
    connectionId: context.connectionId,
    sequence: context.sequence,
    identity: marketIdentity,
    price,
    sourceTimestampEpochMs,
    receivedAtEpochMs: context.receivedAtEpochMs,
    receivedAtMonotonicMs: context.receivedAtMonotonicMs,
    payoutSnapshot: payout(payload, marketIdentity.canonicalAssetId, context.receivedAtEpochMs),
  };
}

export function parsePocketOptionProductionFrame(text: string, context: ParseContext): SemanticPriceEvent | null {
  const packet = unwrapSocketIoPayload(text);
  if (!packet || packet.length !== 2) return null;
  const eventName = packet[0];
  const payload = packet[1];
  if (typeof eventName !== 'string' || !isJsonObject(payload)) return null;
  return parseDirect(eventName, payload, context)
    ?? parseStream(eventName, payload, context)
    ?? parseHistory(eventName, payload, context);
}

export function extractSocketIoEventName(text: string): string | null {
  const packet = unwrapSocketIoPayload(text);
  return packet && typeof packet[0] === 'string' ? packet[0] : null;
}
