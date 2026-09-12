import type { ShadowFeedState } from '../../common/models/runtime-telemetry.js';
import type { SemanticMarketEvent } from '../../common/protocol/market-events.js';
import {
  extractSocketIoEventName,
  isPocketOptionMarketWebSocketUrl,
  PocketOptionSocketIoDecoder,
} from '../../common/protocol/pocket-option-parser.js';

export interface ShadowRecoveryContext {
  pageSessionId: string;
  connectionId: string;
  endpointUrl: string;
  kind: 'MARKET_ENDPOINT' | 'AUTH_PACKET' | 'SUBSCRIPTION_PACKET';
  socketIoEventName: string | null;
  packet: string | null;
  capturedAt: number;
}

export interface ShadowConnectionSnapshot {
  connected: boolean;
  state: ShadowFeedState;
  endpointHost: string | null;
  reconnectAttempts: number;
  lastMessageAt: number | null;
  lastPriceAt: number | null;
  lastErrorReason: string | null;
  pageSessionId: string | null;
  connectionId: string | null;
}

export interface ShadowTransportEvent {
  type:
    | 'SHADOW_WS_CONNECTING'
    | 'SHADOW_WS_OPEN'
    | 'SHADOW_AUTHENTICATED'
    | 'SHADOW_WS_CLOSE'
    | 'SHADOW_WS_ERROR'
    | 'SHADOW_RECONNECT_SCHEDULED'
    | 'SHADOW_STALL_DETECTED';
  occurredAt: number;
  connectionId: string | null;
  endpointHost: string | null;
  pageSessionId: string | null;
  reason: string | null;
}

export interface ShadowMarketConnectionCallbacks {
  onSemanticEvent(event: SemanticMarketEvent, pageSessionId: string): Promise<void>;
  onTransportEvent(event: ShadowTransportEvent): void;
}

const SAFE_SUBSCRIPTION_EVENTS = new Set(['changeSymbol', 'subfor', 'subscribeSymbol', 'ps']);
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000] as const;
const STALL_AFTER_MS = 15_000;

function parseSocketIoPacket(text: string): unknown[] | null {
  if (!text.startsWith('42[')) return null;
  try {
    const value: unknown = JSON.parse(text.slice(2));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function isSafeShadowReplayPacket(text: string, eventName: string): boolean {
  if (!SAFE_SUBSCRIPTION_EVENTS.has(eventName)) return false;
  const packet = parseSocketIoPacket(text);
  if (!packet || packet[0] !== eventName) return false;
  if (eventName === 'ps') return packet.length === 1;
  if (eventName === 'subfor' || eventName === 'subscribeSymbol') {
    const asset = packet[1];
    return packet.length === 2 && typeof asset === 'string' && asset.toLowerCase().endsWith('_otc');
  }
  const payload = packet[1];
  if (packet.length !== 2 || typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return typeof record.asset === 'string'
    && record.asset.toLowerCase().endsWith('_otc')
    && typeof record.period === 'number'
    && Number.isFinite(record.period)
    && record.period > 0;
}

function validAuthPacket(text: string): boolean {
  if (text.length === 0 || text.length > 16_384) return false;
  return extractSocketIoEventName(text) === 'auth';
}

function subscriptionKey(packet: string, eventName: string): string {
  if (eventName !== 'subscribeSymbol') return eventName;
  const parsed = parseSocketIoPacket(packet);
  const asset = parsed?.[1];
  return typeof asset === 'string' ? `${eventName}:${asset}` : eventName;
}

function endpointHost(endpointUrl: string | null): string | null {
  if (endpointUrl === null) return null;
  try {
    return new URL(endpointUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function validEndpoint(endpointUrl: string): boolean {
  if (!isPocketOptionMarketWebSocketUrl(endpointUrl)) return false;
  try {
    const url = new URL(endpointUrl);
    return url.protocol === 'wss:'
      && url.pathname.startsWith('/socket.io/')
      && url.searchParams.get('EIO') === '4'
      && url.searchParams.get('transport') === 'websocket';
  } catch {
    return false;
  }
}

export class ShadowMarketConnection {
  private endpointUrl: string | null = null;
  private authPacket: string | null = null;
  private pageSessionId: string | null = null;
  private sourceConnectionId: string | null = null;
  private readonly subscriptions = new Map<string, string>();
  private socket: WebSocket | null = null;
  private decoder: PocketOptionSocketIoDecoder | null = null;
  private shadowConnectionCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private state: ShadowFeedState = 'WAITING_CONTEXT';
  private reconnectAttempts = 0;
  private lastMessageAt: number | null = null;
  private lastPriceAt: number | null = null;
  private lastErrorReason: string | null = null;
  private awaitingAuthSuccessAttachment = false;
  private intentionalClose = false;

  public constructor(private readonly callbacks: ShadowMarketConnectionCallbacks) {}

  public updateContext(context: ShadowRecoveryContext): void {
    if (!validEndpoint(context.endpointUrl)) return;
    this.pageSessionId = context.pageSessionId;
    this.sourceConnectionId = context.connectionId;
    if (context.kind === 'MARKET_ENDPOINT') {
      if (this.endpointUrl !== context.endpointUrl) {
        this.endpointUrl = context.endpointUrl;
        this.closeSocket('ENDPOINT_CHANGED');
      }
    } else if (context.kind === 'AUTH_PACKET') {
      if (context.packet === null || !validAuthPacket(context.packet)) return;
      this.endpointUrl = context.endpointUrl;
      const changed = this.authPacket !== context.packet;
      this.authPacket = context.packet;
      if (changed && this.socket && this.state === 'STREAMING') this.closeSocket('AUTH_CONTEXT_CHANGED');
    } else if (context.kind === 'SUBSCRIPTION_PACKET') {
      if (context.packet === null || context.socketIoEventName === null || !isSafeShadowReplayPacket(context.packet, context.socketIoEventName)) return;
      this.endpointUrl = context.endpointUrl;
      this.subscriptions.set(subscriptionKey(context.packet, context.socketIoEventName), context.packet);
      if (this.state === 'STREAMING') this.sendSafe(context.packet);
    }
    this.ensureConnected();
  }

  public replaceSnapshot(input: {
    pageSessionId: string;
    endpoint: ShadowRecoveryContext | null;
    auth: ShadowRecoveryContext | null;
    subscriptions: ShadowRecoveryContext[];
  }): void {
    if (input.endpoint) this.updateContext(input.endpoint);
    if (input.auth) this.updateContext(input.auth);
    for (const item of input.subscriptions) this.updateContext(item);
  }

  public ensureConnected(): void {
    if (!this.endpointUrl || !this.authPacket || !this.pageSessionId) {
      this.state = 'WAITING_CONTEXT';
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
    this.connect();
  }

  public watchdog(nowMs: number): void {
    if (this.state === 'STREAMING' && this.lastPriceAt !== null && nowMs - this.lastPriceAt > STALL_AFTER_MS) {
      this.emitTransport('SHADOW_STALL_DETECTED', nowMs, `NO_PRICE_${nowMs - this.lastPriceAt}MS`);
      this.closeSocket('PRICE_STREAM_STALLED');
      this.scheduleReconnect('PRICE_STREAM_STALLED');
      return;
    }
    if (!this.socket && this.endpointUrl && this.authPacket && this.pageSessionId) this.ensureConnected();
  }

  public shouldOwnFeed(feedId: string, nowMs: number): boolean {
    const host = endpointHost(this.endpointUrl);
    return host === feedId
      && this.state === 'STREAMING'
      && this.lastPriceAt !== null
      && nowMs - this.lastPriceAt <= STALL_AFTER_MS;
  }

  public snapshot(): ShadowConnectionSnapshot {
    return {
      connected: this.socket?.readyState === WebSocket.OPEN && this.state === 'STREAMING',
      state: this.state,
      endpointHost: endpointHost(this.endpointUrl),
      reconnectAttempts: this.reconnectAttempts,
      lastMessageAt: this.lastMessageAt,
      lastPriceAt: this.lastPriceAt,
      lastErrorReason: this.lastErrorReason,
      pageSessionId: this.pageSessionId,
      connectionId: this.decoderConnectionId(),
    };
  }

  private decoderConnectionId(): string | null {
    if (!this.decoder) return null;
    return `shadow-${this.shadowConnectionCounter}`;
  }

  private connect(): void {
    if (!this.endpointUrl || !this.authPacket || !this.pageSessionId) return;
    this.clearReconnectTimer();
    this.intentionalClose = false;
    this.awaitingAuthSuccessAttachment = false;
    const connectionId = `shadow-${++this.shadowConnectionCounter}`;
    this.decoder = new PocketOptionSocketIoDecoder(connectionId, this.endpointUrl);
    this.state = 'CONNECTING';
    this.emitTransport('SHADOW_WS_CONNECTING', Date.now(), null, connectionId);
    try {
      const socket = new WebSocket(this.endpointUrl);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.state = 'CONNECTING';
        this.emitTransport('SHADOW_WS_OPEN', Date.now(), null, connectionId);
      });
      socket.addEventListener('message', (event: MessageEvent<unknown>) => {
        void this.handleMessage(event.data, connectionId).catch(() => this.fail('MESSAGE_PROCESSING_FAILED'));
      });
      socket.addEventListener('error', () => {
        this.fail('SOCKET_ERROR');
      });
      socket.addEventListener('close', () => {
        const expected = this.intentionalClose;
        this.socket = null;
        this.decoder = null;
        this.emitTransport('SHADOW_WS_CLOSE', Date.now(), expected ? 'EXPECTED_CLOSE' : 'UNEXPECTED_CLOSE', connectionId);
        if (!expected) this.scheduleReconnect('UNEXPECTED_CLOSE');
      });
    } catch {
      this.fail('SOCKET_CONSTRUCTION_FAILED');
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
        socket.send('40');
        this.state = 'NAMESPACE_OPEN';
        return;
      }
      if (data.startsWith('40')) {
        if (!this.authPacket) return;
        socket.send(this.authPacket);
        this.state = 'AUTHENTICATING';
        return;
      }
      if (data === '1' || data.startsWith('41')) {
        this.fail('REMOTE_NAMESPACE_CLOSED');
        return;
      }
      const eventName = extractSocketIoEventName(data);
      if (eventName === 'successauth') this.awaitingAuthSuccessAttachment = true;
    }
    const decoder = this.decoder;
    if (!decoder) return;
    const events = await decoder.ingest(data, { receivedAtEpochMs: Date.now(), receivedAtMonotonicMs: performance.now() });
    if (typeof data !== 'string' && this.awaitingAuthSuccessAttachment) {
      this.awaitingAuthSuccessAttachment = false;
      this.state = 'STREAMING';
      this.reconnectAttempts = 0;
      this.lastErrorReason = null;
      this.emitTransport('SHADOW_AUTHENTICATED', Date.now(), null, connectionId);
      this.replaySubscriptions();
    }
    for (const event of events) {
      if (event.type === 'SEMANTIC_PRICE') {
        this.lastPriceAt = event.receivedAtEpochMs;
        if (this.state !== 'STREAMING') this.state = 'STREAMING';
      }
      const pageSessionId = this.pageSessionId;
      if (pageSessionId) await this.callbacks.onSemanticEvent(event, `shadow:${pageSessionId}`);
    }
  }

  private replaySubscriptions(): void {
    const orderedPackets: string[] = [];
    for (const [key, packet] of this.subscriptions) {
      if (key.startsWith('subscribeSymbol:')) orderedPackets.push(packet);
    }
    for (const eventName of ['changeSymbol', 'subfor', 'ps']) {
      const packet = this.subscriptions.get(eventName);
      if (packet) orderedPackets.push(packet);
    }
    for (const packet of orderedPackets) this.sendSafe(packet);
  }

  private sendSafe(packet: string): void {
    const eventName = extractSocketIoEventName(packet);
    if (!eventName || !isSafeShadowReplayPacket(packet, eventName)) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || this.state !== 'STREAMING') return;
    socket.send(packet);
  }

  private fail(reason: string): void {
    this.lastErrorReason = reason;
    this.state = 'ERROR';
    this.emitTransport('SHADOW_WS_ERROR', Date.now(), reason);
    this.closeSocket(reason);
    this.scheduleReconnect(reason);
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
    }
  }

  private scheduleReconnect(reason: string): void {
    if (!this.endpointUrl || !this.authPacket || !this.pageSessionId) {
      this.state = 'WAITING_CONTEXT';
      return;
    }
    if (this.reconnectTimer !== null) return;
    this.state = 'BACKOFF';
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)] ?? 20_000;
    this.reconnectAttempts += 1;
    this.emitTransport('SHADOW_RECONNECT_SCHEDULED', Date.now(), `${reason}:${delay}MS`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private emitTransport(type: ShadowTransportEvent['type'], occurredAt: number, reason: string | null, connectionId = this.decoderConnectionId()): void {
    this.callbacks.onTransportEvent({
      type,
      occurredAt,
      connectionId,
      endpointHost: endpointHost(this.endpointUrl),
      pageSessionId: this.pageSessionId,
      reason,
    });
  }
}
