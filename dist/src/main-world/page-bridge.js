import { extractSocketIoEventName, isPocketOptionMarketWebSocketUrl, PocketOptionSocketIoDecoder, } from '../common/protocol/pocket-option-parser.js';
import { isSafeShadowReplayPacket, isValidShadowAuthPacket, isValidShadowEndpoint, SHADOW_NAMESPACE_REJECT_LIMIT, SHADOW_STALL_AFTER_MS, shadowReconnectDelayMs, shadowSubscriptionKey, } from '../common/protocol/shadow-market-policy.js';
const BRIDGE_SOURCE = 'OTC_ELITE_PAGE_BRIDGE_V3';
const CONTROL_SOURCE = 'OTC_ELITE_ISOLATED_CONTROL_V3';
const PAGE_ORIGIN = window.location.origin;
const PAGE_ORIGIN_USABLE = PAGE_ORIGIN !== 'null' && PAGE_ORIGIN.startsWith('https://');
function endpointHost(endpointUrl) {
    if (endpointUrl === null)
        return null;
    try {
        return new URL(endpointUrl).hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
class MainWorldShadowMarketConnection {
    NativeWebSocket;
    emit;
    endpointUrl = null;
    authPacket = null;
    subscriptions = new Map();
    socket = null;
    decoder = null;
    shadowCounter = 0;
    reconnectTimer = null;
    state = 'WAITING_CONTEXT';
    reconnectAttempts = 0;
    consecutiveNamespaceRejects = 0;
    lastMessageAt = null;
    lastPriceAt = null;
    lastErrorReason = null;
    awaitingAuthAttachment = false;
    intentionalClose = false;
    primary = false;
    constructor(NativeWebSocket, emit) {
        this.NativeWebSocket = NativeWebSocket;
        this.emit = emit;
    }
    observeEndpoint(endpointUrl) {
        if (!isValidShadowEndpoint(endpointUrl))
            return;
        if (this.endpointUrl !== endpointUrl) {
            this.endpointUrl = endpointUrl;
            this.authPacket = null;
            this.subscriptions.clear();
            this.resetCircuit('ENDPOINT_CHANGED');
            this.closeSocket('ENDPOINT_CHANGED');
        }
    }
    observePageConnectionOpen(endpointUrl) {
        if (!isValidShadowEndpoint(endpointUrl))
            return;
        this.endpointUrl = endpointUrl;
        if (this.state === 'CIRCUIT_OPEN')
            this.resetCircuit('PAGE_CONNECTION_OPEN');
        this.ensureConnected();
    }
    observeAuth(endpointUrl, packet) {
        if (!isValidShadowEndpoint(endpointUrl) || !isValidShadowAuthPacket(packet))
            return;
        this.endpointUrl = endpointUrl;
        const changed = this.authPacket !== packet;
        this.authPacket = packet;
        if (changed || this.state === 'CIRCUIT_OPEN')
            this.resetCircuit('AUTH_CONTEXT_REFRESHED');
        if (changed && this.socket)
            this.closeSocket('AUTH_CONTEXT_CHANGED');
        this.ensureConnected();
    }
    observeSubscription(packet, eventName) {
        if (!isSafeShadowReplayPacket(packet, eventName))
            return;
        this.subscriptions.set(shadowSubscriptionKey(packet, eventName), packet);
        if (this.state === 'STREAMING')
            this.sendSafe(packet);
    }
    handleControl(command) {
        if (command === 'RESET_CIRCUIT') {
            this.resetCircuit('SUPERVISOR_RESET');
            this.ensureConnected();
            return;
        }
        if (command === 'FORCE_RECONNECT') {
            if (this.state === 'CIRCUIT_OPEN')
                return;
            this.emitTransport('SHADOW_FORCED_RECONNECT', 'SERVICE_WORKER_WATCHDOG');
            this.cancelReconnectTimer();
            this.closeSocket('SERVICE_WORKER_WATCHDOG');
            this.scheduleReconnect('SERVICE_WORKER_WATCHDOG');
            return;
        }
        this.ensureConnected();
    }
    isPrimaryForHost(host, nowMs = Date.now()) {
        return host !== null
            && host === endpointHost(this.endpointUrl)
            && this.primary
            && this.state === 'STREAMING'
            && this.lastPriceAt !== null
            && nowMs - this.lastPriceAt <= SHADOW_STALL_AFTER_MS;
    }
    ensureConnected() {
        if (!this.endpointUrl || !this.authPacket) {
            this.state = 'WAITING_CONTEXT';
            this.emitTransport('SHADOW_WS_CONNECTING', 'WAITING_CONTEXT');
            return;
        }
        if (this.state === 'CIRCUIT_OPEN' || this.reconnectTimer !== null)
            return;
        if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN))
            return;
        this.connect();
    }
    connect() {
        if (!this.endpointUrl || !this.authPacket || this.state === 'CIRCUIT_OPEN')
            return;
        if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN))
            return;
        this.intentionalClose = false;
        this.awaitingAuthAttachment = false;
        this.primary = false;
        const connectionId = `shadow-main-${++this.shadowCounter}`;
        this.decoder = new PocketOptionSocketIoDecoder(connectionId, this.endpointUrl);
        this.state = 'ENGINE_CONNECTING';
        this.emitTransport('SHADOW_WS_CONNECTING', null, connectionId);
        try {
            const socket = new this.NativeWebSocket(this.endpointUrl);
            socket.binaryType = 'arraybuffer';
            this.socket = socket;
            socket.addEventListener('open', () => {
                this.state = 'ENGINE_OPEN';
                this.emit({ type: 'CONNECTION', connectionId, transportRole: 'SHADOW', event: 'OPEN', feedHost: endpointHost(this.endpointUrl), receivedAtEpochMs: Date.now() });
                this.emitTransport('SHADOW_WS_OPEN', null, connectionId);
            });
            socket.addEventListener('message', (event) => {
                void this.handleMessage(event.data, connectionId).catch(() => this.fail('MESSAGE_PROCESSING_FAILED', connectionId));
            });
            socket.addEventListener('error', () => this.fail('SOCKET_ERROR', connectionId));
            socket.addEventListener('close', () => {
                const expected = this.intentionalClose;
                this.socket = null;
                this.decoder = null;
                this.primary = false;
                this.emit({ type: 'CONNECTION', connectionId, transportRole: 'SHADOW', event: 'CLOSE', feedHost: endpointHost(this.endpointUrl), receivedAtEpochMs: Date.now() });
                this.emitTransport('SHADOW_WS_CLOSE', expected ? 'EXPECTED_CLOSE' : 'UNEXPECTED_CLOSE', connectionId);
                if (!expected && this.state !== 'CIRCUIT_OPEN')
                    this.scheduleReconnect('UNEXPECTED_CLOSE');
                else if (expected && this.state !== 'CIRCUIT_OPEN')
                    this.ensureConnected();
            });
        }
        catch {
            this.fail('SOCKET_CONSTRUCTION_FAILED', connectionId);
        }
    }
    async handleMessage(data, connectionId) {
        this.lastMessageAt = Date.now();
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN)
            return;
        if (typeof data === 'string') {
            if (data === '2') {
                socket.send('3');
                return;
            }
            if (data.startsWith('0')) {
                this.state = 'NAMESPACE_CONNECTING';
                this.emitTransport('SHADOW_NAMESPACE_CONNECTING', null, connectionId);
                socket.send('40');
                return;
            }
            if (data.startsWith('40')) {
                this.state = 'NAMESPACE_OPEN';
                this.emitTransport('SHADOW_NAMESPACE_OPEN', null, connectionId);
                if (!this.authPacket)
                    return;
                socket.send(this.authPacket);
                this.state = 'AUTH_SENT';
                this.emitTransport('SHADOW_AUTH_SENT', null, connectionId);
                return;
            }
            if (data === '1' || data.startsWith('41')) {
                this.namespaceRejected(connectionId);
                return;
            }
            if (extractSocketIoEventName(data) === 'successauth')
                this.awaitingAuthAttachment = true;
        }
        const decoder = this.decoder;
        if (!decoder)
            return;
        const events = await decoder.ingest(data, { receivedAtEpochMs: Date.now(), receivedAtMonotonicMs: performance.now() });
        if (typeof data !== 'string' && this.awaitingAuthAttachment) {
            this.awaitingAuthAttachment = false;
            this.state = 'AUTHENTICATED';
            this.reconnectAttempts = 0;
            this.consecutiveNamespaceRejects = 0;
            this.lastErrorReason = null;
            this.emitTransport('SHADOW_AUTHENTICATED', null, connectionId);
            this.replaySubscriptions(connectionId);
        }
        for (const event of events) {
            if (event.type === 'SEMANTIC_PRICE') {
                this.lastPriceAt = event.receivedAtEpochMs;
                if (this.state !== 'STREAMING') {
                    this.state = 'STREAMING';
                    this.primary = true;
                    this.emitTransport('SHADOW_STREAMING', null, connectionId);
                }
            }
            if (this.state === 'STREAMING' || event.type === 'SEMANTIC_PAYOUT')
                this.emit(event);
        }
    }
    replaySubscriptions(connectionId) {
        const ordered = [];
        for (const [key, packet] of this.subscriptions)
            if (key.startsWith('subscribeSymbol:'))
                ordered.push(packet);
        for (const eventName of ['changeSymbol', 'subfor', 'ps']) {
            const packet = this.subscriptions.get(eventName);
            if (packet)
                ordered.push(packet);
        }
        for (const packet of ordered)
            this.sendSafe(packet);
        this.state = 'SUBSCRIPTIONS_REPLAYED';
        this.emitTransport('SHADOW_SUBSCRIPTIONS_REPLAYED', `COUNT_${ordered.length}`, connectionId);
    }
    sendSafe(packet) {
        const eventName = extractSocketIoEventName(packet);
        if (!eventName || !isSafeShadowReplayPacket(packet, eventName))
            return;
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN)
            return;
        if (this.state !== 'AUTHENTICATED' && this.state !== 'SUBSCRIPTIONS_REPLAYED' && this.state !== 'STREAMING')
            return;
        socket.send(packet);
    }
    namespaceRejected(connectionId) {
        this.consecutiveNamespaceRejects += 1;
        this.lastErrorReason = 'REMOTE_NAMESPACE_CLOSED';
        if (this.consecutiveNamespaceRejects >= SHADOW_NAMESPACE_REJECT_LIMIT) {
            this.state = 'CIRCUIT_OPEN';
            this.primary = false;
            this.cancelReconnectTimer();
            this.emitTransport('SHADOW_CIRCUIT_OPEN', `NAMESPACE_REJECTS_${this.consecutiveNamespaceRejects}`, connectionId);
            this.closeSocket('CIRCUIT_OPEN');
            return;
        }
        this.fail('REMOTE_NAMESPACE_CLOSED', connectionId);
    }
    fail(reason, connectionId) {
        this.lastErrorReason = reason;
        this.state = 'ERROR';
        this.primary = false;
        this.emitTransport('SHADOW_WS_ERROR', reason, connectionId);
        this.closeSocket(reason);
        this.scheduleReconnect(reason);
    }
    scheduleReconnect(reason) {
        if (!this.endpointUrl || !this.authPacket || this.state === 'CIRCUIT_OPEN' || this.reconnectTimer !== null)
            return;
        const delay = shadowReconnectDelayMs(this.reconnectAttempts);
        this.reconnectAttempts += 1;
        this.state = 'BACKOFF';
        this.emitTransport('SHADOW_RECONNECT_SCHEDULED', `${reason}:${delay}MS`);
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }
    closeSocket(reason) {
        const socket = this.socket;
        if (!socket)
            return;
        this.intentionalClose = true;
        this.lastErrorReason = reason;
        try {
            socket.close();
        }
        catch {
            this.socket = null;
            this.decoder = null;
            this.primary = false;
        }
    }
    cancelReconnectTimer() {
        if (this.reconnectTimer === null)
            return;
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }
    resetCircuit(reason) {
        const wasOpen = this.state === 'CIRCUIT_OPEN';
        this.consecutiveNamespaceRejects = 0;
        this.reconnectAttempts = 0;
        if (wasOpen) {
            this.state = 'WAITING_CONTEXT';
            this.emitTransport('SHADOW_CIRCUIT_RESET', reason);
        }
    }
    emitTransport(eventType, reason, connectionId = this.decoderConnectionId()) {
        const payload = {
            type: 'SHADOW_TRANSPORT',
            eventType,
            occurredAt: Date.now(),
            connectionId,
            endpointHost: endpointHost(this.endpointUrl),
            state: this.state,
            connected: this.socket?.readyState === WebSocket.OPEN,
            primary: this.primary,
            reconnectAttempts: this.reconnectAttempts,
            consecutiveNamespaceRejects: this.consecutiveNamespaceRejects,
            circuitOpen: this.state === 'CIRCUIT_OPEN',
            lastMessageAt: this.lastMessageAt,
            lastPriceAt: this.lastPriceAt,
            lastErrorReason: this.lastErrorReason,
            reason,
        };
        this.emit(payload);
    }
    decoderConnectionId() {
        return this.decoder ? `shadow-main-${this.shadowCounter}` : null;
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
    const shadow = new MainWorldShadowMarketConnection(OriginalWebSocket, emit);
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
        const command = record.command;
        if (command === 'ENSURE_CONNECTED' || command === 'FORCE_RECONNECT' || command === 'RESET_CIRCUIT')
            shadow.handleControl(command);
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
            shadow.observeEndpoint(this.endpointUrl);
            this.addEventListener('open', () => {
                shadow.observePageConnectionOpen(this.endpointUrl);
                emit({ type: 'CONNECTION', connectionId: this.connectionId, transportRole: 'PAGE', event: 'OPEN', feedHost: this.feedHost, receivedAtEpochMs: Date.now() });
            });
            this.addEventListener('close', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, transportRole: 'PAGE', event: 'CLOSE', feedHost: this.feedHost, receivedAtEpochMs: Date.now() }));
            this.addEventListener('error', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, transportRole: 'PAGE', event: 'ERROR', feedHost: this.feedHost, receivedAtEpochMs: Date.now() }));
            this.addEventListener('message', (event) => {
                const timing = { receivedAtEpochMs: Date.now(), receivedAtMonotonicMs: performance.now() };
                this.inboundQueue = this.inboundQueue.then(() => this.processInbound(event.data, timing)).catch(() => undefined);
            });
        }
        send(data) {
            if (this.observed && typeof data === 'string') {
                const eventName = extractSocketIoEventName(data);
                if (eventName === 'auth')
                    shadow.observeAuth(this.endpointUrl, data);
                else if (eventName !== null)
                    shadow.observeSubscription(data, eventName);
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
            for (const event of events) {
                if ((event.type === 'SEMANTIC_PRICE' || event.type === 'SEMANTIC_PAYOUT') && shadow.isPrimaryForHost(this.feedHost, timing.receivedAtEpochMs))
                    continue;
                emit(event);
            }
        }
    }
    window.WebSocket = InterceptedWebSocket;
}
setupPageBridge();
