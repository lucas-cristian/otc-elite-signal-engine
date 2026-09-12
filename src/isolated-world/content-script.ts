const OTC_BRIDGE_SOURCE = 'OTC_ELITE_PAGE_BRIDGE_V3';
const OTC_CONTROL_SOURCE = 'OTC_ELITE_ISOLATED_CONTROL_V3';
const OTC_PORT_NAME = 'OTC_ELITE_SEMANTIC_STREAM_V1';
const otcPageOrigin = window.location.origin;
const otcPageOriginUsable = otcPageOrigin !== 'null' && otcPageOrigin.startsWith('https://');
const otcPageSessionId = crypto.randomUUID();
const otcConnections = new Map<string, { nextSequence: number; pending: Map<number, Record<string, unknown>> }>();
const otcOutbox: Array<{ pageSessionId: string; event: Record<string, unknown> }> = [];
let otcPort: chrome.runtime.Port | null = null;
let otcFlushQueued = false;
let otcPortReconnectQueued = false;

function otcIsRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function otcHasSemanticEnvelope(value: Record<string, unknown>): boolean { return typeof value.connectionId === 'string' && Number.isInteger(value.sequence) && (value.sequence as number) >= 0; }
function otcIsConnectionEvent(value: unknown): value is Record<string, unknown> {
  return otcIsRecord(value) && value.type === 'CONNECTION' && typeof value.connectionId === 'string' && (value.feedHost === null || typeof value.feedHost === 'string') && (value.event === 'OPEN' || value.event === 'CLOSE' || value.event === 'ERROR');
}
function otcIsSemanticPriceEvent(value: unknown): value is Record<string, unknown> {
  if (!otcIsRecord(value) || value.type !== 'SEMANTIC_PRICE' || !otcHasSemanticEnvelope(value)) return false;
  if (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price <= 0) return false;
  if (typeof value.receivedAtEpochMs !== 'number' || typeof value.receivedAtMonotonicMs !== 'number' || typeof value.sourceClockSynchronized !== 'boolean') return false;
  if (!otcIsRecord(value.identity)) return false;
  return value.identity.platform === 'POCKET_OPTION' && value.identity.marketType === 'OTC' && typeof value.identity.feedId === 'string';
}
function otcIsSemanticPayoutEvent(value: unknown): value is Record<string, unknown> {
  return otcIsRecord(value) && value.type === 'SEMANTIC_PAYOUT' && otcHasSemanticEnvelope(value) && otcIsRecord(value.payoutSnapshot) && value.payoutSnapshot.payoutSnapshotSchemaVersion === '3';
}
function otcIsDiscoveryObservation(value: unknown): value is Record<string, unknown> { return otcIsRecord(value) && value.type === 'DISCOVERY_OBSERVATION' && typeof value.connectionId === 'string' && typeof value.byteLength === 'number'; }
function otcIsShadowTransport(value: unknown): value is Record<string, unknown> {
  return otcIsRecord(value)
    && value.type === 'SHADOW_TRANSPORT'
    && typeof value.eventType === 'string'
    && typeof value.occurredAt === 'number'
    && typeof value.state === 'string'
    && typeof value.connected === 'boolean'
    && typeof value.primary === 'boolean'
    && typeof value.reconnectAttempts === 'number'
    && typeof value.consecutiveNamespaceRejects === 'number'
    && typeof value.circuitOpen === 'boolean';
}
function otcQueuePortReconnect(): void {
  if (otcPortReconnectQueued) return;
  otcPortReconnectQueued = true;
  queueMicrotask(() => {
    otcPortReconnectQueued = false;
    try { otcConnectPort(); } catch { return; }
  });
}
function otcConnectPort(): chrome.runtime.Port {
  if (otcPort) return otcPort;
  const port = chrome.runtime.connect({ name: OTC_PORT_NAME });
  otcPort = port;
  port.onMessage.addListener((message) => {
    if (!otcIsRecord(message) || message.type !== 'SHADOW_CONTROL') return;
    const command = message.command;
    if (command !== 'ENSURE_CONNECTED' && command !== 'FORCE_RECONNECT' && command !== 'RESET_CIRCUIT') return;
    if (otcPageOriginUsable) window.postMessage({ source: OTC_CONTROL_SOURCE, command }, otcPageOrigin);
  });
  port.onDisconnect.addListener(() => {
    if (otcPort === port) otcPort = null;
    otcQueuePortReconnect();
    if (otcOutbox.length > 0) otcQueueFlush();
  });
  otcSendLifecycle('PORT_CONNECTED');
  return port;
}
function otcPostPort(message: unknown): boolean {
  try { otcConnectPort().postMessage(message); return true; }
  catch { otcPort = null; otcQueuePortReconnect(); return false; }
}
function otcQueueFlush(): void { if (!otcFlushQueued) { otcFlushQueued = true; queueMicrotask(otcFlush); } }
function otcFlush(): void {
  otcFlushQueued = false;
  if (otcOutbox.length === 0) return;
  const payload = otcOutbox.splice(0, Math.min(otcOutbox.length, 100));
  if (!otcPostPort({ type: 'SEMANTIC_EVENT_BATCH', payload, sentAt: Date.now() })) { otcOutbox.unshift(...payload); return; }
  if (otcOutbox.length > 0) otcQueueFlush();
}
function otcPushSemantic(event: Record<string, unknown>): void {
  const connectionId = event.connectionId as string;
  const sequence = event.sequence as number;
  const state = otcConnections.get(connectionId);
  if (!state || sequence < state.nextSequence) return;
  state.pending.set(sequence, event);
  while (state.pending.has(state.nextSequence)) {
    const ordered = state.pending.get(state.nextSequence);
    if (!ordered) break;
    state.pending.delete(state.nextSequence);
    state.nextSequence += 1;
    otcOutbox.push({ pageSessionId: otcPageSessionId, event: ordered });
  }
  otcQueueFlush();
}
function otcSendLifecycle(reason: string): void {
  otcPostPort({ type: 'SOURCE_TAB_LIFECYCLE', payload: { pageSessionId: otcPageSessionId, reason, visibility: document.visibilityState, hidden: document.hidden, capturedAt: Date.now() } });
}
window.addEventListener('message', (messageEvent: MessageEvent<unknown>) => {
  if (!otcPageOriginUsable || messageEvent.source !== window || messageEvent.origin !== otcPageOrigin) return;
  if (!otcIsRecord(messageEvent.data) || messageEvent.data.source !== OTC_BRIDGE_SOURCE) return;
  const payload = messageEvent.data.payload;
  if (otcIsConnectionEvent(payload)) {
    const connectionId = payload.connectionId as string;
    if (payload.event === 'OPEN') otcConnections.set(connectionId, { nextSequence: 0, pending: new Map() });
    else otcConnections.delete(connectionId);
    otcPostPort({ type: 'SOURCE_CONNECTION_EVENT', payload: { pageSessionId: otcPageSessionId, event: payload, capturedAt: Date.now() } });
    return;
  }
  if (otcIsShadowTransport(payload)) {
    otcPostPort({ type: 'SHADOW_TRANSPORT_EVENT', payload: { ...payload, pageSessionId: otcPageSessionId } });
    return;
  }
  if (otcIsSemanticPriceEvent(payload) || otcIsSemanticPayoutEvent(payload)) { otcPushSemantic(payload); return; }
  if (otcIsDiscoveryObservation(payload)) otcPostPort({ type: 'PROTOCOL_DISCOVERY_OBSERVATION', payload });
});
document.addEventListener('visibilitychange', () => otcSendLifecycle('VISIBILITY_CHANGE'));
window.addEventListener('pageshow', () => otcSendLifecycle('PAGE_SHOW'));
window.addEventListener('pagehide', () => otcSendLifecycle('PAGE_HIDE'));
document.addEventListener('freeze', () => otcSendLifecycle('PAGE_FREEZE'));
document.addEventListener('resume', () => otcSendLifecycle('PAGE_RESUME'));
if (otcPageOriginUsable) {
  otcConnectPort();
  otcSendLifecycle('CONTENT_SCRIPT_READY');
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/main-world/page-bridge.js');
  script.type = 'module';
  script.onload = () => {
    script.remove();
    void chrome.storage.local.get(['protocolMode']).then((settings) => {
      const mode = settings.protocolMode === 'PROTOCOL_DISCOVERY' ? 'PROTOCOL_DISCOVERY' : 'PRODUCTION';
      window.postMessage({ source: OTC_CONTROL_SOURCE, mode }, otcPageOrigin);
    });
  };
  (document.head || document.documentElement).appendChild(script);
}
