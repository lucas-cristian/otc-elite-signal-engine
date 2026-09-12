import { extractSocketIoEventName, isPocketOptionMarketWebSocketUrl, PocketOptionSocketIoDecoder, } from '../common/protocol/pocket-option-parser.js';
const BRIDGE_SOURCE = 'OTC_ELITE_PAGE_BRIDGE_V2';
const CONTROL_SOURCE = 'OTC_ELITE_ISOLATED_CONTROL_V2';
const PAGE_ORIGIN = window.location.origin;
const PAGE_ORIGIN_USABLE = PAGE_ORIGIN !== 'null' && PAGE_ORIGIN.startsWith('https://');
const SAFE_SUBSCRIPTION_EVENTS = new Set(['changeSymbol', 'subfor', 'subscribeSymbol', 'ps']);
function endpointHost(endpointUrl) {
    try {
        return new URL(endpointUrl).hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
function setupPageBridge() {
    const OriginalWebSocket = window.WebSocket;
    let connectionCounter = 0;
    let mode = 'PRODUCTION';
    const emit = (payload) => {
        if (!PAGE_ORIGIN_USABLE)
            return;
        window.postMessage({ source: BRIDGE_SOURCE, payload }, PAGE_ORIGIN);
    };
    const discoveryObservation = (connectionId, direction, data, receivedAtEpochMs) => {
        let payloadType = 'UNKNOWN';
        let byteLength = 0;
        let socketIoEventName = null;
        if (typeof data === 'string') {
            payloadType = 'TEXT';
            byteLength = new TextEncoder().encode(data).byteLength;
            socketIoEventName = extractSocketIoEventName(data);
        }
        else if (data instanceof ArrayBuffer) {
            payloadType = 'BINARY';
            byteLength = data.byteLength;
        }
        else if (ArrayBuffer.isView(data)) {
            payloadType = 'BINARY';
            byteLength = data.byteLength;
        }
        else if (data instanceof Blob) {
            payloadType = 'BLOB';
            byteLength = data.size;
        }
        return { type: 'DISCOVERY_OBSERVATION', connectionId, direction, payloadType, byteLength, socketIoEventName, receivedAtEpochMs };
    };
    const recoveryContext = (connectionId, endpointUrl, kind, packet, socketIoEventName) => ({
        type: 'RECOVERY_CONTEXT',
        connectionId,
        kind,
        endpointUrl,
        socketIoEventName,
        packet,
        capturedAt: Date.now(),
    });
    window.addEventListener('message', (event) => {
        if (!PAGE_ORIGIN_USABLE || event.source !== window || event.origin !== PAGE_ORIGIN)
            return;
        const data = event.data;
        if (typeof data !== 'object' || data === null)
            return;
        const record = data;
        if (record.source !== CONTROL_SOURCE)
            return;
        const nextMode = record.mode;
        if (nextMode === 'PRODUCTION' || nextMode === 'PROTOCOL_DISCOVERY')
            mode = nextMode;
    });
    class InterceptedWebSocket extends OriginalWebSocket {
        connectionId;
        observed;
        decoder;
        endpointUrl;
        feedHost;
        inboundQueue = Promise.resolve();
        constructor(url, protocols) {
            super(url, protocols);
            this.endpointUrl = String(url);
            this.feedHost = endpointHost(this.endpointUrl);
            this.connectionId = `ws-${++connectionCounter}`;
            this.observed = isPocketOptionMarketWebSocketUrl(this.endpointUrl);
            this.decoder = new PocketOptionSocketIoDecoder(this.connectionId, this.endpointUrl);
            if (!this.observed)
                return;
            emit(recoveryContext(this.connectionId, this.endpointUrl, 'MARKET_ENDPOINT', null, null));
            this.addEventListener('open', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'OPEN', feedHost: this.feedHost, receivedAtEpochMs: Date.now() }));
            this.addEventListener('close', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'CLOSE', feedHost: this.feedHost, receivedAtEpochMs: Date.now() }));
            this.addEventListener('error', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'ERROR', feedHost: this.feedHost, receivedAtEpochMs: Date.now() }));
            this.addEventListener('message', (event) => {
                const timing = { receivedAtEpochMs: Date.now(), receivedAtMonotonicMs: performance.now() };
                const data = event.data;
                this.inboundQueue = this.inboundQueue
                    .then(() => this.processInbound(data, timing))
                    .catch(() => undefined);
            });
        }
        send(data) {
            if (this.observed && typeof data === 'string') {
                const eventName = extractSocketIoEventName(data);
                if (eventName === 'auth') {
                    emit(recoveryContext(this.connectionId, this.endpointUrl, 'AUTH_PACKET', data, eventName));
                }
                else if (eventName !== null && SAFE_SUBSCRIPTION_EVENTS.has(eventName)) {
                    emit(recoveryContext(this.connectionId, this.endpointUrl, 'SUBSCRIPTION_PACKET', data, eventName));
                }
            }
            if (this.observed && mode === 'PROTOCOL_DISCOVERY')
                emit(discoveryObservation(this.connectionId, 'OUTBOUND', data, Date.now()));
            super.send(data);
        }
        async processInbound(data, timing) {
            if (mode === 'PROTOCOL_DISCOVERY') {
                emit(discoveryObservation(this.connectionId, 'INBOUND', data, timing.receivedAtEpochMs));
                return;
            }
            const events = await this.decoder.ingest(data, timing);
            for (const event of events)
                emit(event);
        }
    }
    window.WebSocket = InterceptedWebSocket;
}
setupPageBridge();
