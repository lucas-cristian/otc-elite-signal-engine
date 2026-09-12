const OTC_BRIDGE_SOURCE = 'OTC_ELITE_PAGE_BRIDGE_V2';
const OTC_CONTROL_SOURCE = 'OTC_ELITE_ISOLATED_CONTROL_V2';
const otcPageOrigin = window.location.origin;
const otcPageOriginUsable = otcPageOrigin !== 'null' && otcPageOrigin.startsWith('https://');
const otcPageSessionId = crypto.randomUUID();
const otcConnections = new Map<string, { nextSequence: number; pending: Map<number, Record<string, unknown>> }>();
const otcBatch: Array<{ pageSessionId: string; event: Record<string, unknown> }> = [];
let otcFlushTimer: number | null = null;

function otcIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function otcIsConnectionEvent(value: unknown): value is Record<string, unknown> {
  if (!otcIsRecord(value) || value.type !== 'CONNECTION' || typeof value.connectionId !== 'string') return false;
  return value.event === 'OPEN' || value.event === 'CLOSE' || value.event === 'ERROR';
}

function otcIsDiscoveryObservation(value: unknown): value is Record<string, unknown> {
  return otcIsRecord(value)
    && value.type === 'DISCOVERY_OBSERVATION'
    && typeof value.connectionId === 'string'
    && typeof value.byteLength === 'number';
}

function otcHasSemanticEnvelope(value: Record<string, unknown>): boolean {
  return typeof value.connectionId === 'string'
    && Number.isInteger(value.sequence)
    && (value.sequence as number) >= 0;
}

function otcIsSemanticPriceEvent(value: unknown): value is Record<string, unknown> {
  if (!otcIsRecord(value) || value.type !== 'SEMANTIC_PRICE' || !otcHasSemanticEnvelope(value)) return false;
  if (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price <= 0) return false;
  if (typeof value.receivedAtEpochMs !== 'number' || typeof value.receivedAtMonotonicMs !== 'number') return false;
  if (typeof value.sourceClockSynchronized !== 'boolean') return false;
  if (value.sourceQuality !== 'VERIFIED' && value.sourceQuality !== 'INFERRED' && value.sourceQuality !== 'UNKNOWN') return false;
  if (value.sourceQuality === 'VERIFIED' && (typeof value.protocolVerificationId !== 'string' || value.protocolVerificationId.length === 0)) return false;
  if (value.sourceQuality !== 'VERIFIED' && value.protocolVerificationId !== null) return false;
  if (!otcIsRecord(value.identity)) return false;
  return value.identity.platform === 'POCKET_OPTION'
    && value.identity.marketType === 'OTC'
    && value.identity.source === 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON'
    && typeof value.identity.canonicalAssetId === 'string'
    && typeof value.identity.instrumentId === 'string'
    && typeof value.identity.feedId === 'string'
    && typeof value.identity.parserSchemaId === 'string';
}

function otcIsSemanticPayoutEvent(value: unknown): value is Record<string, unknown> {
  if (!otcIsRecord(value) || value.type !== 'SEMANTIC_PAYOUT' || !otcHasSemanticEnvelope(value)) return false;
  if (!otcIsRecord(value.payoutSnapshot)) return false;
  const payout = value.payoutSnapshot;
  return payout.payoutSnapshotSchemaVersion === '3'
    && typeof payout.canonicalAssetId === 'string'
    && payout.expirationBinding === 'UNBOUND'
    && typeof payout.payoutRate === 'number'
    && Number.isFinite(payout.payoutRate)
    && payout.payoutRate >= 0
    && payout.payoutRate <= 1
    && typeof payout.capturedAt === 'number'
    && typeof payout.feedId === 'string'
    && typeof payout.parserSchemaId === 'string'
    && ((payout.quality === 'VERIFIED' && typeof payout.protocolVerificationId === 'string' && payout.protocolVerificationId.length > 0)
      || (payout.quality !== 'VERIFIED' && payout.protocolVerificationId === null));
}

function otcScheduleFlush(): void {
  if (otcFlushTimer !== null) return;
  otcFlushTimer = window.setTimeout(otcFlush, 50);
}

function otcFlush(): void {
  otcFlushTimer = null;
  if (otcBatch.length === 0) return;
  const payload = otcBatch.splice(0, otcBatch.length);
  void chrome.runtime.sendMessage({ type: 'SEMANTIC_EVENT_BATCH', payload });
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
    otcBatch.push({ pageSessionId: otcPageSessionId, event: ordered });
    if (otcBatch.length >= 50) otcFlush(); else otcScheduleFlush();
  }
}

window.addEventListener('message', (messageEvent: MessageEvent<unknown>) => {
  if (!otcPageOriginUsable || messageEvent.source !== window || messageEvent.origin !== otcPageOrigin) return;
  if (!otcIsRecord(messageEvent.data) || messageEvent.data.source !== OTC_BRIDGE_SOURCE) return;
  const payload = messageEvent.data.payload;
  if (otcIsConnectionEvent(payload)) {
    const connectionId = payload.connectionId as string;
    if (payload.event === 'OPEN') otcConnections.set(connectionId, { nextSequence: 0, pending: new Map() });
    else otcConnections.delete(connectionId);
    return;
  }
  if (otcIsSemanticPriceEvent(payload) || otcIsSemanticPayoutEvent(payload)) {
    otcPushSemantic(payload);
    return;
  }
  if (otcIsDiscoveryObservation(payload)) void chrome.runtime.sendMessage({ type: 'PROTOCOL_DISCOVERY_OBSERVATION', payload });
});

if (otcPageOriginUsable) {
  const otcBridgeScript = document.createElement('script');
  otcBridgeScript.src = chrome.runtime.getURL('src/main-world/page-bridge.js');
  otcBridgeScript.type = 'module';
  otcBridgeScript.onload = () => {
    otcBridgeScript.remove();
    void chrome.storage.local.get(['protocolMode']).then((settings) => {
      const mode = settings.protocolMode === 'PROTOCOL_DISCOVERY' ? 'PROTOCOL_DISCOVERY' : 'PRODUCTION';
      window.postMessage({ source: OTC_CONTROL_SOURCE, mode }, otcPageOrigin);
    });
  };
  (document.head || document.documentElement).appendChild(otcBridgeScript);
}
