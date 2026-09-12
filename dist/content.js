"use strict";
const OTC_BRIDGE_SOURCE = 'OTC_ELITE_PAGE_BRIDGE_V2';
const OTC_CONTROL_SOURCE = 'OTC_ELITE_ISOLATED_CONTROL_V2';
const otcPageSessionId = crypto.randomUUID();
const otcConnections = new Map();
const otcBatch = [];
let otcFlushTimer = null;
function otcIsRecord(value) {
    return typeof value === 'object' && value !== null;
}
function otcIsConnectionEvent(value) {
    if (!otcIsRecord(value) || value.type !== 'CONNECTION' || typeof value.connectionId !== 'string')
        return false;
    return value.event === 'OPEN' || value.event === 'CLOSE' || value.event === 'ERROR';
}
function otcIsDiscoveryObservation(value) {
    return otcIsRecord(value)
        && value.type === 'DISCOVERY_OBSERVATION'
        && typeof value.connectionId === 'string'
        && typeof value.byteLength === 'number';
}
function otcIsSemanticPriceEvent(value) {
    if (!otcIsRecord(value) || value.type !== 'SEMANTIC_PRICE')
        return false;
    if (typeof value.connectionId !== 'string' || !Number.isInteger(value.sequence))
        return false;
    if (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price <= 0)
        return false;
    if (typeof value.receivedAtEpochMs !== 'number' || typeof value.receivedAtMonotonicMs !== 'number')
        return false;
    if (!otcIsRecord(value.identity))
        return false;
    return value.identity.platform === 'POCKET_OPTION'
        && value.identity.marketType === 'OTC'
        && typeof value.identity.canonicalAssetId === 'string'
        && typeof value.identity.instrumentId === 'string'
        && typeof value.identity.parserSchemaId === 'string';
}
function otcScheduleFlush() {
    if (otcFlushTimer !== null)
        return;
    otcFlushTimer = window.setTimeout(otcFlush, 50);
}
function otcFlush() {
    otcFlushTimer = null;
    if (otcBatch.length === 0)
        return;
    const payload = otcBatch.splice(0, otcBatch.length);
    void chrome.runtime.sendMessage({ type: 'SEMANTIC_EVENT_BATCH', payload });
}
function otcPushSemantic(event) {
    const connectionId = event.connectionId;
    const sequence = event.sequence;
    const state = otcConnections.get(connectionId);
    if (!state || sequence < state.nextSequence)
        return;
    state.pending.set(sequence, event);
    while (state.pending.has(state.nextSequence)) {
        const ordered = state.pending.get(state.nextSequence);
        if (!ordered)
            break;
        state.pending.delete(state.nextSequence);
        state.nextSequence += 1;
        otcBatch.push({ pageSessionId: otcPageSessionId, event: ordered });
        if (otcBatch.length >= 50)
            otcFlush();
        else
            otcScheduleFlush();
    }
}
window.addEventListener('message', (messageEvent) => {
    if (messageEvent.source !== window || messageEvent.origin !== window.location.origin)
        return;
    if (!otcIsRecord(messageEvent.data) || messageEvent.data.source !== OTC_BRIDGE_SOURCE)
        return;
    const payload = messageEvent.data.payload;
    if (otcIsConnectionEvent(payload)) {
        const connectionId = payload.connectionId;
        if (payload.event === 'OPEN')
            otcConnections.set(connectionId, { nextSequence: 0, pending: new Map() });
        else
            otcConnections.delete(connectionId);
        return;
    }
    if (otcIsSemanticPriceEvent(payload)) {
        otcPushSemantic(payload);
        return;
    }
    if (otcIsDiscoveryObservation(payload))
        void chrome.runtime.sendMessage({ type: 'PROTOCOL_DISCOVERY_OBSERVATION', payload });
});
void chrome.storage.local.get(['protocolMode']).then((settings) => {
    const mode = settings.protocolMode === 'PROTOCOL_DISCOVERY' ? 'PROTOCOL_DISCOVERY' : 'PRODUCTION';
    window.postMessage({ source: OTC_CONTROL_SOURCE, mode }, window.location.origin);
});
const otcBridgeScript = document.createElement('script');
otcBridgeScript.src = chrome.runtime.getURL('src/main-world/page-bridge.js');
otcBridgeScript.type = 'module';
otcBridgeScript.onload = () => otcBridgeScript.remove();
(document.head || document.documentElement).appendChild(otcBridgeScript);
