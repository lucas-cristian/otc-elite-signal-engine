import { extractSocketIoEventName, isPocketOptionMarketWebSocketUrl, PocketOptionSocketIoDecoder, } from '../common/protocol/pocket-option-parser.js';
const BRIDGE_SOURCE = 'OTC_ELITE_PAGE_BRIDGE_V2';
const CONTROL_SOURCE = 'OTC_ELITE_ISOLATED_CONTROL_V2';
function setupPageBridge() {
    const OriginalWebSocket = window.WebSocket;
    let connectionCounter = 0;
    let mode = 'PRODUCTION';
    const emit = (payload) => {
        window.postMessage({ source: BRIDGE_SOURCE, payload }, window.location.origin);
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
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin)
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
        inboundQueue = Promise.resolve();
        constructor(url, protocols) {
            super(url, protocols);
            const endpointUrl = String(url);
            this.connectionId = `ws-${++connectionCounter}`;
            this.observed = isPocketOptionMarketWebSocketUrl(endpointUrl);
            this.decoder = new PocketOptionSocketIoDecoder(this.connectionId, endpointUrl);
            if (!this.observed)
                return;
            this.addEventListener('open', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'OPEN', receivedAtEpochMs: Date.now() }));
            this.addEventListener('close', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'CLOSE', receivedAtEpochMs: Date.now() }));
            this.addEventListener('error', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'ERROR', receivedAtEpochMs: Date.now() }));
            this.addEventListener('message', (event) => {
                const timing = { receivedAtEpochMs: Date.now(), receivedAtMonotonicMs: performance.now() };
                const data = event.data;
                this.inboundQueue = this.inboundQueue
                    .then(() => this.processInbound(data, timing))
                    .catch(() => undefined);
            });
        }
        send(data) {
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
