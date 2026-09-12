import { getCanonicalAssetId } from '../hashing/canonical-hash.js';
function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseJsonValue(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function unwrapSocketIoPayload(text) {
    if (!text.startsWith('42['))
        return null;
    const parsed = parseJsonValue(text.slice(2));
    return Array.isArray(parsed) ? parsed : null;
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
function identity(asset, payload, parserSchemaId) {
    const canonicalAssetId = getCanonicalAssetId(asset);
    const explicitInstrument = nonEmptyString(payload.instrumentId) ?? nonEmptyString(payload.symbol) ?? nonEmptyString(payload.asset);
    if (!explicitInstrument)
        throw new TypeError('Instrument identity is required');
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
function payout(payload, canonicalAssetId, capturedAt) {
    const raw = finiteNumber(payload.payout) ?? finiteNumber(payload.payoutRate);
    if (raw === null)
        return null;
    const payoutRate = raw > 1 ? raw / 100 : raw;
    if (payoutRate < 0 || payoutRate > 1)
        return null;
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
function plausibleEpochMs(value, receivedAtEpochMs) {
    const maxDelta = 24 * 60 * 60 * 1000;
    return Math.abs(receivedAtEpochMs - value) <= maxDelta ? value : null;
}
function parseDirect(eventName, payload, context) {
    if (eventName !== 'update' && eventName !== 'price_update')
        return null;
    const asset = nonEmptyString(payload.asset) ?? nonEmptyString(payload.symbol);
    const price = finiteNumber(payload.price) ?? finiteNumber(payload.rate);
    if (!asset || price === null || price <= 0)
        return null;
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
function parseStream(eventName, payload, context) {
    if (eventName !== 'updateStream')
        return null;
    const asset = nonEmptyString(payload.asset) ?? nonEmptyString(payload.symbol);
    const data = payload.data;
    if (!asset || !Array.isArray(data) || data.length === 0)
        return null;
    const last = data[data.length - 1];
    if (!Array.isArray(last) || last.length < 2)
        return null;
    const timestampSeconds = finiteNumber(last[0]);
    const price = finiteNumber(last[1]);
    if (timestampSeconds === null || price === null || price <= 0)
        return null;
    const sourceTimestampEpochMs = plausibleEpochMs(timestampSeconds * 1000, context.receivedAtEpochMs);
    if (sourceTimestampEpochMs === null)
        return null;
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
function parseHistory(eventName, payload, context) {
    if (eventName !== 'updateHistoryNew')
        return null;
    const asset = nonEmptyString(payload.asset) ?? nonEmptyString(payload.symbol);
    const history = payload.history;
    if (!asset || !Array.isArray(history) || history.length === 0)
        return null;
    const last = history[history.length - 1];
    if (!Array.isArray(last) || last.length < 2)
        return null;
    const timestampSeconds = finiteNumber(last[0]);
    const price = finiteNumber(last[1]);
    if (timestampSeconds === null || price === null || price <= 0)
        return null;
    const sourceTimestampEpochMs = plausibleEpochMs(timestampSeconds * 1000, context.receivedAtEpochMs);
    if (sourceTimestampEpochMs === null)
        return null;
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
export function parsePocketOptionProductionFrame(text, context) {
    const packet = unwrapSocketIoPayload(text);
    if (!packet || packet.length !== 2)
        return null;
    const eventName = packet[0];
    const payload = packet[1];
    if (typeof eventName !== 'string' || !isJsonObject(payload))
        return null;
    return parseDirect(eventName, payload, context)
        ?? parseStream(eventName, payload, context)
        ?? parseHistory(eventName, payload, context);
}
export function extractSocketIoEventName(text) {
    const packet = unwrapSocketIoPayload(text);
    return packet && typeof packet[0] === 'string' ? packet[0] : null;
}
