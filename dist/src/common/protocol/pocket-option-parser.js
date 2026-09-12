import { getCanonicalAssetId } from '../hashing/canonical-hash.js';
import { POCKET_OPTION_PAYOUT_SCHEMA_ID, POCKET_OPTION_STREAM_SCHEMA_ID, resolveProtocolVerification, } from './protocol-verification-registry.js';
function parseJsonValue(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
function endpointHost(endpointUrl) {
    try {
        return new URL(endpointUrl).hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
function isPocketOptionMarketHost(host) {
    return host !== null && (host === 'po.market' || host.endsWith('.po.market'));
}
function isOtcAsset(asset) {
    return asset.toLowerCase().endsWith('_otc');
}
function identity(asset, endpointUrl, parserSchemaId) {
    const host = endpointHost(endpointUrl);
    if (!host || !isPocketOptionMarketHost(host) || !isOtcAsset(asset))
        return null;
    return {
        marketSourceIdentitySchemaVersion: '2',
        platform: 'POCKET_OPTION',
        canonicalAssetId: getCanonicalAssetId(asset),
        marketType: 'OTC',
        source: 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON',
        feedId: host,
        instrumentId: asset,
        parserSchemaId,
    };
}
function plausibleSourceTimestampMs(value, receivedAtEpochMs) {
    if (!Number.isFinite(value) || value <= 0)
        return null;
    const maxDelta = 24 * 60 * 60 * 1000;
    return Math.abs(receivedAtEpochMs - value) <= maxDelta ? value : null;
}
function parseBinaryHeader(text) {
    const match = /^45(\d+)-(.+)$/.exec(text);
    if (!match)
        return null;
    const attachmentCountText = match[1];
    const payloadText = match[2];
    if (!attachmentCountText || !payloadText)
        return null;
    const attachmentCount = Number.parseInt(attachmentCountText, 10);
    if (!Number.isSafeInteger(attachmentCount) || attachmentCount !== 1)
        return null;
    const packet = parseJsonValue(payloadText);
    if (!Array.isArray(packet) || packet.length !== 2)
        return null;
    const eventName = nonEmptyString(packet[0]);
    const placeholder = packet[1];
    if (!eventName || typeof placeholder !== 'object' || placeholder === null || Array.isArray(placeholder))
        return null;
    const placeholderRecord = placeholder;
    if (placeholderRecord._placeholder !== true || placeholderRecord.num !== 0)
        return null;
    return { eventName, attachmentCount };
}
function parseUpdateStream(payload, context) {
    if (!Array.isArray(payload) || payload.length === 0)
        return [];
    const host = endpointHost(context.endpointUrl);
    if (!host || !isPocketOptionMarketHost(host))
        return [];
    const verification = resolveProtocolVerification({
        feedHost: host,
        eventKind: 'PRICE_STREAM',
        socketIoEventName: 'updateStream',
        parserSchemaId: POCKET_OPTION_STREAM_SCHEMA_ID,
        payloadShapeId: 'OTC_STREAM_TRIPLE_V1',
        marketType: 'OTC',
    });
    const events = [];
    for (const row of payload) {
        if (!Array.isArray(row) || row.length !== 3)
            return [];
        const asset = nonEmptyString(row[0]);
        const timestampSeconds = finiteNumber(row[1]);
        const price = finiteNumber(row[2]);
        if (!asset || timestampSeconds === null || price === null || price <= 0)
            return [];
        if (!isOtcAsset(asset))
            continue;
        const marketIdentity = identity(asset, context.endpointUrl, POCKET_OPTION_STREAM_SCHEMA_ID);
        if (!marketIdentity)
            return [];
        const sourceTimestampEpochMs = plausibleSourceTimestampMs(timestampSeconds * 1000, context.receivedAtEpochMs);
        if (sourceTimestampEpochMs === null)
            return [];
        events.push({
            type: 'SEMANTIC_PRICE',
            connectionId: context.connectionId,
            identity: marketIdentity,
            price,
            sourceTimestampEpochMs,
            sourceClockSynchronized: false,
            sourceQuality: verification.quality,
            protocolVerificationId: verification.verificationId,
            receivedAtEpochMs: context.receivedAtEpochMs,
            receivedAtMonotonicMs: context.receivedAtMonotonicMs,
        });
    }
    return events;
}
function parseChafor(payload, context) {
    if (!Array.isArray(payload) || payload.length === 0)
        return [];
    const host = endpointHost(context.endpointUrl);
    if (!host || !isPocketOptionMarketHost(host))
        return [];
    const verification = resolveProtocolVerification({
        feedHost: host,
        eventKind: 'PAYOUT',
        socketIoEventName: 'chafor',
        parserSchemaId: POCKET_OPTION_PAYOUT_SCHEMA_ID,
        payloadShapeId: 'OTC_PAYOUT_PAIR_V1',
        marketType: 'OTC',
    });
    const events = [];
    for (const row of payload) {
        if (!Array.isArray(row) || row.length !== 2)
            return [];
        const asset = nonEmptyString(row[0]);
        const payoutPercent = finiteNumber(row[1]);
        if (!asset || payoutPercent === null || payoutPercent < 0 || payoutPercent > 100)
            return [];
        if (!isOtcAsset(asset))
            continue;
        const payoutSnapshot = {
            payoutSnapshotSchemaVersion: '3',
            canonicalAssetId: getCanonicalAssetId(asset),
            expirationSeconds: null,
            expirationBinding: 'UNBOUND',
            payoutRate: payoutPercent / 100,
            capturedAt: context.receivedAtEpochMs,
            source: 'PLATFORM_PROTOCOL',
            quality: verification.quality,
            feedId: host,
            parserSchemaId: POCKET_OPTION_PAYOUT_SCHEMA_ID,
            protocolVerificationId: verification.verificationId,
        };
        events.push({ type: 'SEMANTIC_PAYOUT', connectionId: context.connectionId, payoutSnapshot });
    }
    return events;
}
function parseVerifiedAttachment(eventName, text, context) {
    if (eventName === 'updateHistoryNewFast')
        return [];
    if (eventName !== 'updateStream' && eventName !== 'chafor')
        return [];
    const payload = parseJsonValue(text);
    if (payload === null)
        return [];
    return eventName === 'updateStream' ? parseUpdateStream(payload, context) : parseChafor(payload, context);
}
async function binaryText(data) {
    if (data instanceof Blob)
        return data.text();
    if (data instanceof ArrayBuffer)
        return new TextDecoder().decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data))
        return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return null;
}
export class PocketOptionSocketIoDecoder {
    connectionId;
    endpointUrl;
    pendingBinaryEvent = null;
    nextSemanticSequence = 0;
    constructor(connectionId, endpointUrl) {
        this.connectionId = connectionId;
        this.endpointUrl = endpointUrl;
    }
    async ingest(data, timing) {
        if (typeof data === 'string') {
            this.pendingBinaryEvent = parseBinaryHeader(data);
            return [];
        }
        const pending = this.pendingBinaryEvent;
        this.pendingBinaryEvent = null;
        if (!pending)
            return [];
        const text = await binaryText(data);
        if (text === null)
            return [];
        const drafts = parseVerifiedAttachment(pending.eventName, text, {
            connectionId: this.connectionId,
            endpointUrl: this.endpointUrl,
            ...timing,
        });
        return drafts.map((draft) => ({ ...draft, sequence: this.nextSemanticSequence++ }));
    }
}
export function extractSocketIoEventName(text) {
    const binary = parseBinaryHeader(text);
    if (binary)
        return binary.eventName;
    if (!text.startsWith('42['))
        return null;
    const packet = parseJsonValue(text.slice(2));
    return Array.isArray(packet) ? nonEmptyString(packet[0]) : null;
}
export function isPocketOptionMarketWebSocketUrl(url) {
    return isPocketOptionMarketHost(endpointHost(url));
}
