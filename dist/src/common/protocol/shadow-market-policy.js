import { extractSocketIoEventName, isPocketOptionMarketWebSocketUrl } from './pocket-option-parser.js';
export const SHADOW_SAFE_SUBSCRIPTION_EVENTS = new Set(['changeSymbol', 'subfor', 'subscribeSymbol', 'ps']);
export const SHADOW_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000];
export const SHADOW_NAMESPACE_REJECT_LIMIT = 5;
export const SHADOW_STALL_AFTER_MS = 15_000;
export function parseSocketIoPacket(text) {
    if (!text.startsWith('42['))
        return null;
    try {
        const value = JSON.parse(text.slice(2));
        return Array.isArray(value) ? value : null;
    }
    catch {
        return null;
    }
}
export function isValidShadowAuthPacket(text) {
    return text.length > 0 && text.length <= 16_384 && extractSocketIoEventName(text) === 'auth';
}
export function isSafeShadowReplayPacket(text, eventName) {
    if (!SHADOW_SAFE_SUBSCRIPTION_EVENTS.has(eventName))
        return false;
    const packet = parseSocketIoPacket(text);
    if (!packet || packet[0] !== eventName)
        return false;
    if (eventName === 'ps')
        return packet.length === 1;
    if (eventName === 'subfor' || eventName === 'subscribeSymbol') {
        const asset = packet[1];
        return packet.length === 2 && typeof asset === 'string' && asset.toLowerCase().endsWith('_otc');
    }
    const payload = packet[1];
    if (packet.length !== 2 || typeof payload !== 'object' || payload === null || Array.isArray(payload))
        return false;
    const record = payload;
    return typeof record.asset === 'string'
        && record.asset.toLowerCase().endsWith('_otc')
        && typeof record.period === 'number'
        && Number.isFinite(record.period)
        && record.period > 0;
}
export function shadowSubscriptionKey(packet, eventName) {
    if (eventName !== 'subscribeSymbol')
        return eventName;
    const parsed = parseSocketIoPacket(packet);
    const asset = parsed?.[1];
    return typeof asset === 'string' ? `${eventName}:${asset}` : eventName;
}
export function isValidShadowEndpoint(endpointUrl) {
    if (!isPocketOptionMarketWebSocketUrl(endpointUrl))
        return false;
    try {
        const url = new URL(endpointUrl);
        return url.protocol === 'wss:'
            && url.pathname.startsWith('/socket.io/')
            && url.searchParams.get('EIO') === '4'
            && url.searchParams.get('transport') === 'websocket';
    }
    catch {
        return false;
    }
}
export function shadowReconnectDelayMs(reconnectAttempts) {
    return SHADOW_RECONNECT_DELAYS_MS[Math.min(Math.max(0, reconnectAttempts), SHADOW_RECONNECT_DELAYS_MS.length - 1)] ?? 20_000;
}
