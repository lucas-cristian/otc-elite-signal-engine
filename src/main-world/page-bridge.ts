import type { ShadowFeedState, TransportEventType } from '../common/models/runtime-telemetry.js';
import type { MainToIsolatedEvent, RuntimeMode, SemanticMarketEvent, ShadowBridgeTransportEvent, ShadowControlCommand } from '../common/protocol/market-events.js';
import {
  extractSocketIoEventName,
  isPocketOptionMarketWebSocketUrl,
  PocketOptionSocketIoDecoder,
} from '../common/protocol/pocket-option-parser.js';
import {
  isSafeShadowReplayPacket,
  isValidShadowAuthPacket,
  isValidShadowEndpoint,
  SHADOW_NAMESPACE_REJECT_LIMIT,
  SHADOW_STALL_AFTER_MS,
  shadowReconnectDelayMs,
  shadowSubscriptionKey,
} from '../common/protocol/shadow-market-policy.js';

const BRIDGE_SOURCE = 'OTC_ELITE_PAGE_BRIDGE_V3';
const CONTROL_SOURCE = 'OTC_ELITE_ISOLATED_CONTROL_V3';
const PAGE_ORIGIN = window.location.origin;
const PAGE_ORIGIN_USABLE = PAGE_ORIGIN !== 'null' && PAGE_ORIGIN.startsWith('https://');

type NativeWebSocketConstructor = typeof WebSocket;

function endpointHost(endpointUrl: string | null): string | null {
  if (endpointUrl === null) return null;
  try {
    return new URL(endpointUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

class MainWorldShadowMarketConnection {
  private endpointUrl: string | null = null;
  private authPacket: string | null = null;
  private readonly subscriptions = new Map<string, string>();
  private socket: WebSocket | null = null;
  private decoder: PocketOptionSocketIoDecoder | null = null;
  private shadowCounter = 0;
  private reconnectTimer: number | null = null;
  private state: ShadowFeedState = 'WAITING_CONTEXT';
  private reconnectAttempts = 0;
  private consecutiveNamespaceRejects = 0;
  private lastMessageAt: number | null = null;
  private lastPriceAt: number | null = null;
  private lastErrorReason: string | null = null;
  private awaitingAuthAttachment = false;
  private intentionalClose = false;
  private primary = false;

  public constructor(
    private readonly NativeWebSocket: NativeWebSocketConstructor,
    private readonly emit: (payload: MainToIsolatedEvent) => void,
  ) {}

  public observeEndpoint(endpointUrl: string): void {
    if (!isValidShadowEndpoint(endpointUrl)) return;
    if (this.endpointUrl !== endpointUrl) {
      this.endpointUrl = endpointUrl;
      this.authPacket = null;
      this.subscriptions.clear();
      this.resetCircuit('ENDPOINT_CHANGED');
      this.closeSocket('ENDPOINT_CHANGED');
    }
  }

  public observePageConnectionOpen(endpointUrl: string): void {
    if (!isValidShadowEndpoint(endpointUrl)) return;
    this.endpointUrl = endpointUrl;
    if (this.state === 'CIRCUIT_OPEN') this.resetCircuit('PAGE_CONNECTION_OPEN');
    this.ensureConnected();
  }

  public observeAuth(endpointUrl: string, packet: string): void {
    if (!isValidShadowEndpoint(endpointUrl) || !isValidShadowAuthPacket(packet)) return;
    this.endpointUrl = endpointUrl;
    const changed = this.authPacket !== packet;
    this.authPacket = packet;
    if (changed || this.state === 'CIRCUIT_OPEN') this.resetCircuit('AUTH_CONTEXT_REFRESHED');
    if (changed && this.socket) this.closeSocket('AUTH_CONTEXT_CHANGED');
    this.ensureConnected();
  }

  public observeSubscription(packet: string, eventName: string): void {
    if (!isSafeShadowReplayPacket(packet, eventName)) return;
    this.subscriptions.set(shadowSubscriptionKey(packet, eventName), packet);
    if (this.state === 'STREAMING') this.sendSafe(packet);
  }

  public handleControl(command: ShadowControlCommand): void {
    if (command === 'RESET_CIRCUIT') {
      this.resetCircuit('SUPERVISOR_RESET');
      this.ensureConnected();
      return;
    }
    if (command === 'FORCE_RECONNECT') {
      if (this.state === 'CIRCUIT_OPEN') return;
      this.emitTransport('SHADOW_FORCED_RECONNECT', 'SERVICE_WORKER_WATCHDOG');
      this.cancelReconnectTimer();
      this.closeSocket('SERVICE_WORKER_WATCHDOG');
      this.scheduleReconnect('SERVICE_WORKER_WATCHDOG');
      return;
    }
    this.ensureConnected();
  }

  public isPrimaryForHost(host: string | null, nowMs = Date.now()): boolean {
    return host !== null
      && host === endpointHost(this.endpointUrl)
      && this.primary
      && this.state === 'STREAMING'
      && this.lastPriceAt !== null
      && nowMs - this.lastPriceAt <= SHADOW_STALL_AFTER_MS;
  }

  private ensureConnected(): void {
    if (!this.endpointUrl || !this.authPacket) {
      this.state = 'WAITING_CONTEXT';
      this.emitTransport('SHADOW_WS_CONNECTING', 'WAITING_CONTEXT');
      return;
    }
    if (this.state === 'CIRCUIT_OPEN' || this.reconnectTimer !== null) return;
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
    this.connect();
  }

  private connect(): void {
    if (!this.endpointUrl || !this.authPacket || this.state === 'CIRCUIT_OPEN') return;
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
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
        this.emit({ type: 'CONNECTION', connectionId, event: 'OPEN', feedHost: endpointHost(this.endpointUrl), receivedAtEpochMs: Date.now() });
        this.emitTransport('SHADOW_WS_OPEN', null, connectionId);
      });
      socket.addEventListener('message', (event: MessageEvent<unknown>) => {
        void this.handleMessage(event.data, connectionId).catch(() => this.fail('MESSAGE_PROCESSING_FAILED', connectionId));
      });
      socket.addEventListener('error', () => this.fail('SOCKET_ERROR', connectionId));
      socket.addEventListener('close', () => {
        const expected = this.intentionalClose;
        this.socket = null;
        this.decoder = null;
        this.primary = false;
        this.emit({ type: 'CONNECTION', connectionId, event: 'CLOSE', feedHost: endpointHost(this.endpointUrl), receivedAtEpochMs: Date.now() });
        this.emitTransport('SHADOW_WS_CLOSE', expected ? 'EXPECTED_CLOSE' : 'UNEXPECTED_CLOSE', connectionId);
        if (!expected && this.state !== 'CIRCUIT_OPEN') this.scheduleReconnect('UNEXPECTED_CLOSE');
        else if (expected && this.state !== 'CIRCUIT_OPEN') this.ensureConnected();
      });
    } catch {
      this.fail('SOCKET_CONSTRUCTION_FAILED', connectionId);
    }
  }

  private async handleMessage(data: unknown, connectionId: string): Promise<void> {
    this.lastMessageAt = Date.now();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
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
        if (!this.authPacket) return;
        socket.send(this.authPacket);
        this.state = 'AUTH_SENT';
        this.emitTransport('SHADOW_AUTH_SENT', null, connectionId);
        return;
      }
      if (data === '1' || data.startsWith('41')) {
        this.namespaceRejected(connectionId);
        return;
      }
      if (extractSocketIoEventName(data) === 'successauth') this.awaitingAuthAttachment = true;
    }
    const decoder = this.decoder;
    if (!decoder) return;
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
      if (this.state === 'STREAMING' || event.type === 'SEMANTIC_PAYOUT') this.emit(event);
    }
  }

  private replaySubscriptions(connectionId: string): void {
    const ordered: string[] = [];
    for (const [key, packet] of this.subscriptions) if (key.startsWith('subscribeSymbol:')) ordered.push(packet);
    for (const eventName of ['changeSymbol', 'subfor', 'ps']) {
      const packet = this.subscriptions.get(eventName);
      if (packet) ordered.push(packet);
    }
    for (const packet of ordered) this.sendSafe(packet);
    this.state = 'SUBSCRIPTIONS_REPLAYED';
    this.emitTransport('SHADOW_SUBSCRIPTIONS_REPLAYED', `COUNT_${ordered.length}`, connectionId);
  }

  private sendSafe(packet: string): void {
    const eventName = extractSocketIoEventName(packet);
    if (!eventName || !isSafeShadowReplayPacket(packet, eventName)) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (this.state !== 'AUTHENTICATED' && this.state !== 'SUBSCRIPTIONS_REPLAYED' && this.state !== 'STREAMING') return;
    socket.send(packet);
  }

  private namespaceRejected(connectionId: string): void {
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

  private fail(reason: string, connectionId: string | null): void {
    this.lastErrorReason = reason;
    this.state = 'ERROR';
    this.primary = false;
    this.emitTransport('SHADOW_WS_ERROR', reason, connectionId);
    this.closeSocket(reason);
    this.scheduleReconnect(reason);
  }

  private scheduleReconnect(reason: string): void {
    if (!this.endpointUrl || !this.authPacket || this.state === 'CIRCUIT_OPEN' || this.reconnectTimer !== null) return;
    const delay = shadowReconnectDelayMs(this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.state = 'BACKOFF';
    this.emitTransport('SHADOW_RECONNECT_SCHEDULED', `${reason}:${delay}MS`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private closeSocket(reason: string): void {
    const socket = this.socket;
    if (!socket) return;
    this.intentionalClose = true;
    this.lastErrorReason = reason;
    try {
      socket.close();
    } catch {
      this.socket = null;
      this.decoder = null;
      this.primary = false;
    }
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private resetCircuit(reason: string): void {
    const wasOpen = this.state === 'CIRCUIT_OPEN';
    this.consecutiveNamespaceRejects = 0;
    this.reconnectAttempts = 0;
    if (wasOpen) {
      this.state = 'WAITING_CONTEXT';
      this.emitTransport('SHADOW_CIRCUIT_RESET', reason);
    }
  }

  private emitTransport(eventType: TransportEventType, reason: string | null, connectionId: string | null = this.decoderConnectionId()): void {
    const payload: ShadowBridgeTransportEvent = {
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

  private decoderConnectionId(): string | null {
    return this.decoder ? `shadow-main-${this.shadowCounter}` : null;
  }
}

function setupPageBridge(): void {
  const OriginalWebSocket = window.WebSocket;
  let connectionCounter = 0;
  let mode: RuntimeMode = 'PRODUCTION';

  const emit = (payload: MainToIsolatedEvent): void => {
    if (!PAGE_ORIGIN_USABLE) return;
    window.postMessage({ source: BRIDGE_SOURCE, payload }, PAGE_ORIGIN);
  };
  const shadow = new MainWorldShadowMarketConnection(OriginalWebSocket, emit);

  const discoveryObservation = (connectionId: string, direction: 'INBOUND' | 'OUTBOUND', data: unknown, receivedAtEpochMs: number) => {
    let payloadType: 'TEXT' | 'BINARY' | 'BLOB' | 'UNKNOWN' = 'UNKNOWN';
    let byteLength = 0;
    let socketIoEventName: string | null = null;
    if (typeof data === 'string') {
      payloadType = 'TEXT';
      byteLength = new TextEncoder().encode(data).byteLength;
      socketIoEventName = extractSocketIoEventName(data);
    } else if (data instanceof ArrayBuffer) {
      payloadType = 'BINARY';
      byteLength = data.byteLength;
    } else if (ArrayBuffer.isView(data)) {
      payloadType = 'BINARY';
      byteLength = data.byteLength;
    } else if (data instanceof Blob) {
      payloadType = 'BLOB';
      byteLength = data.size;
    }
    return { type: 'DISCOVERY_OBSERVATION' as const, connectionId, direction, payloadType, byteLength, socketIoEventName, receivedAtEpochMs };
  };

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!PAGE_ORIGIN_USABLE || event.source !== window || event.origin !== PAGE_ORIGIN) return;
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    const record = data as Record<string, unknown>;
    if (record.source !== CONTROL_SOURCE) return;
    const nextMode = record.mode;
    if (nextMode === 'PRODUCTION' || nextMode === 'PROTOCOL_DISCOVERY') mode = nextMode;
    const command = record.command;
    if (command === 'ENSURE_CONNECTED' || command === 'FORCE_RECONNECT' || command === 'RESET_CIRCUIT') shadow.handleControl(command);
  });

  class InterceptedWebSocket extends OriginalWebSocket {
    private readonly connectionId: string;
    private readonly observed: boolean;
    private readonly decoder: PocketOptionSocketIoDecoder;
    private readonly endpointUrl: string;
    private readonly feedHost: string | null;
    private inboundQueue: Promise<void> = Promise.resolve();

    public constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.endpointUrl = String(url);
      this.feedHost = endpointHost(this.endpointUrl);
      this.connectionId = `ws-${++connectionCounter}`;
      this.observed = isPocketOptionMarketWebSocketUrl(this.endpointUrl);
      this.decoder = new PocketOptionSocketIoDecoder(this.connectionId, this.endpointUrl);
      if (!this.observed) return;
      shadow.observeEndpoint(this.endpointUrl);
      this.addEventListener('open', () => {
        shadow.observePageConnectionOpen(this.endpointUrl);
        emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'OPEN', feedHost: this.feedHost, receivedAtEpochMs: Date.now() });
      });
      this.addEventListener('close', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'CLOSE', feedHost: this.feedHost, receivedAtEpochMs: Date.now() }));
      this.addEventListener('error', () => emit({ type: 'CONNECTION', connectionId: this.connectionId, event: 'ERROR', feedHost: this.feedHost, receivedAtEpochMs: Date.now() }));
      this.addEventListener('message', (event: MessageEvent<unknown>) => {
        const timing = { receivedAtEpochMs: Date.now(), receivedAtMonotonicMs: performance.now() };
        this.inboundQueue = this.inboundQueue.then(() => this.processInbound(event.data, timing)).catch(() => undefined);
      });
    }

    public override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (this.observed && typeof data === 'string') {
        const eventName = extractSocketIoEventName(data);
        if (eventName === 'auth') shadow.observeAuth(this.endpointUrl, data);
        else if (eventName !== null) shadow.observeSubscription(data, eventName);
      }
      if (this.observed && mode === 'PROTOCOL_DISCOVERY') emit(discoveryObservation(this.connectionId, 'OUTBOUND', data, Date.now()));
      super.send(data);
    }

    private async processInbound(data: unknown, timing: { receivedAtEpochMs: number; receivedAtMonotonicMs: number }): Promise<void> {
      if (mode === 'PROTOCOL_DISCOVERY') {
        emit(discoveryObservation(this.connectionId, 'INBOUND', data, timing.receivedAtEpochMs));
        return;
      }
      const events = await this.decoder.ingest(data, timing);
      for (const event of events) {
        if ((event.type === 'SEMANTIC_PRICE' || event.type === 'SEMANTIC_PAYOUT') && shadow.isPrimaryForHost(this.feedHost, timing.receivedAtEpochMs)) continue;
        emit(event);
      }
    }
  }

  window.WebSocket = InterceptedWebSocket as typeof WebSocket;
}

setupPageBridge();
