import { isSemanticPayoutEvent, isSemanticPriceEvent } from '../../common/validation/semantic-event-validator.js';
import { createValidatedTick } from '../../common/validation/tick-factory.js';
import { computeAnalytics } from '../evaluation/analytics.js';
import { DatasetExporter } from '../export/dataset-exporter.js';
import { IndexedDbJournal, openJournalDatabase } from '../storage/indexeddb-journal.js';
import { DEFAULT_PIPELINE_CONFIG, QuantPipeline } from './quant-pipeline.js';
const WATCHDOG_ALARM_NAME = 'otc-elite-data-health-watchdog';
const WATCHDOG_PERIOD_MINUTES = 0.5;
const SEMANTIC_PORT_NAME = 'OTC_ELITE_SEMANTIC_STREAM_V1';
const discoveryRing = [];
const captureByTab = new Map();
let latestCaptureTabId = null;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function defaultCapture(tabId) {
    return {
        transportSchemaVersion: '1',
        tabId,
        pageSessionId: null,
        connected: false,
        visibility: 'unknown',
        frozen: null,
        discarded: null,
        autoDiscardable: null,
        lastSemanticEventAt: null,
        lastLifecycleEventAt: null,
        lastConnectionEventAt: null,
        lastLifecycleReason: null,
        mitigation: 'RUNTIME_PORT_MICROTASK_FLUSH_AUTO_DISCARD_DISABLED',
    };
}
function captureState(tabId) {
    const existing = captureByTab.get(tabId);
    if (existing)
        return existing;
    const created = defaultCapture(tabId);
    captureByTab.set(tabId, created);
    return created;
}
function latestCapture() {
    if (latestCaptureTabId !== null)
        return captureByTab.get(latestCaptureTabId) ?? defaultCapture(null);
    const latest = [...captureByTab.values()].sort((a, b) => (b.lastSemanticEventAt ?? b.lastLifecycleEventAt ?? 0) - (a.lastSemanticEventAt ?? a.lastLifecycleEventAt ?? 0))[0];
    return latest ?? defaultCapture(null);
}
function visibility(value) {
    return value === 'visible' || value === 'hidden' || value === 'prerender' ? value : 'unknown';
}
async function loadBuildMetadata() {
    const fallbackVersion = chrome.runtime.getManifest().version;
    try {
        const response = await fetch(chrome.runtime.getURL('build-metadata.json'));
        if (!response.ok)
            throw new Error(`build metadata HTTP ${response.status}`);
        const value = await response.json();
        if (!isRecord(value))
            throw new Error('build metadata is not an object');
        const sourceTreeSha256 = value.sourceTreeSha256;
        const gitCommit = value.gitCommit;
        const gitWorkingTreeClean = value.gitWorkingTreeClean;
        if (typeof value.appVersion !== 'string' || typeof value.buildId !== 'string')
            throw new Error('build metadata identity missing');
        if (sourceTreeSha256 !== null && typeof sourceTreeSha256 !== 'string')
            throw new Error('invalid sourceTreeSha256');
        if (gitCommit !== null && typeof gitCommit !== 'string')
            throw new Error('invalid gitCommit');
        if (gitWorkingTreeClean !== null && typeof gitWorkingTreeClean !== 'boolean')
            throw new Error('invalid gitWorkingTreeClean');
        return { appVersion: value.appVersion, buildId: value.buildId, sourceTreeSha256, gitCommit, gitWorkingTreeClean };
    }
    catch {
        return { appVersion: fallbackVersion, buildId: 'runtime-metadata-unavailable', sourceTreeSha256: null, gitCommit: null, gitWorkingTreeClean: null };
    }
}
const runtime = (async () => {
    const [db, buildMetadata] = await Promise.all([openJournalDatabase(), loadBuildMetadata()]);
    const journal = new IndexedDbJournal(db);
    const pipeline = new QuantPipeline(journal, { ...DEFAULT_PIPELINE_CONFIG, appVersion: buildMetadata.appVersion });
    await pipeline.initialize(Date.now());
    chrome.alarms.create(WATCHDOG_ALARM_NAME, { periodInMinutes: WATCHDOG_PERIOD_MINUTES });
    return { journal, pipeline, buildMetadata };
})();
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== WATCHDOG_ALARM_NAME)
        return;
    void runtime.then(({ pipeline }) => pipeline.watchdog(Date.now())).catch(() => undefined);
});
function isDiscoveryObservation(value) {
    if (!isRecord(value))
        return false;
    return value.type === 'DISCOVERY_OBSERVATION'
        && typeof value.connectionId === 'string'
        && typeof value.byteLength === 'number'
        && (value.direction === 'INBOUND' || value.direction === 'OUTBOUND');
}
async function processSemanticBatch(payload, tabId) {
    if (!Array.isArray(payload))
        return;
    const now = Date.now();
    if (tabId !== null) {
        const state = captureState(tabId);
        state.lastSemanticEventAt = now;
        state.connected = true;
        latestCaptureTabId = tabId;
    }
    const { pipeline } = await runtime;
    for (const item of payload) {
        if (!isRecord(item) || typeof item.pageSessionId !== 'string')
            continue;
        if (tabId !== null)
            captureState(tabId).pageSessionId = item.pageSessionId;
        if (isSemanticPriceEvent(item.event)) {
            const tick = createValidatedTick(item.event, item.pageSessionId);
            if (tick.integrity !== 'VALID')
                continue;
            await pipeline.enqueue({ tick });
            continue;
        }
        if (isSemanticPayoutEvent(item.event))
            await pipeline.enqueuePayout(item.event.payoutSnapshot);
    }
    await pipeline.drain();
}
function processLifecycle(payload, tabId) {
    if (tabId === null || !isRecord(payload))
        return;
    const state = captureState(tabId);
    if (typeof payload.pageSessionId === 'string')
        state.pageSessionId = payload.pageSessionId;
    state.visibility = visibility(payload.visibility);
    state.lastLifecycleEventAt = typeof payload.capturedAt === 'number' ? payload.capturedAt : Date.now();
    state.lastLifecycleReason = typeof payload.reason === 'string' ? payload.reason : 'UNKNOWN';
    state.connected = true;
    latestCaptureTabId = tabId;
}
function processConnectionEvent(_payload, tabId) {
    if (tabId === null)
        return;
    const state = captureState(tabId);
    state.lastConnectionEventAt = Date.now();
    state.connected = true;
    latestCaptureTabId = tabId;
}
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SEMANTIC_PORT_NAME)
        return;
    const tabId = port.sender?.tab?.id ?? null;
    if (tabId !== null) {
        const state = captureState(tabId);
        state.connected = true;
        latestCaptureTabId = tabId;
        void chrome.tabs.update(tabId, { autoDiscardable: false }).then((tab) => {
            const current = captureState(tabId);
            current.autoDiscardable = tab?.autoDiscardable ?? false;
            current.discarded = tab?.discarded ?? current.discarded;
            current.frozen = tab?.frozen ?? current.frozen;
        }).catch(() => undefined);
    }
    port.onMessage.addListener((message) => {
        if (!isRecord(message))
            return;
        if (message.type === 'SEMANTIC_EVENT_BATCH') {
            void processSemanticBatch(message.payload, tabId).catch(() => undefined);
            return;
        }
        if (message.type === 'PROTOCOL_DISCOVERY_OBSERVATION') {
            if (isDiscoveryObservation(message.payload)) {
                discoveryRing.push(message.payload);
                if (discoveryRing.length > 100)
                    discoveryRing.splice(0, discoveryRing.length - 100);
            }
            return;
        }
        if (message.type === 'SOURCE_TAB_LIFECYCLE') {
            processLifecycle(message.payload, tabId);
            return;
        }
        if (message.type === 'SOURCE_CONNECTION_EVENT')
            processConnectionEvent(message.payload, tabId);
    });
    port.onDisconnect.addListener(() => {
        if (tabId === null)
            return;
        captureState(tabId).connected = false;
    });
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!captureByTab.has(tabId))
        return;
    const state = captureState(tabId);
    if (typeof changeInfo.frozen === 'boolean')
        state.frozen = changeInfo.frozen;
    if (typeof changeInfo.discarded === 'boolean')
        state.discarded = changeInfo.discarded;
    if (typeof changeInfo.autoDiscardable === 'boolean')
        state.autoDiscardable = changeInfo.autoDiscardable;
    if (tab.autoDiscardable === true)
        void chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((tabId) => {
    captureByTab.delete(tabId);
    if (latestCaptureTabId === tabId)
        latestCaptureTabId = null;
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRecord(message))
        return;
    if (message.type === 'SEMANTIC_EVENT_BATCH') {
        void processSemanticBatch(message.payload, sender.tab?.id ?? null)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'runtime failure' }));
        return true;
    }
    if (message.type === 'PROTOCOL_DISCOVERY_OBSERVATION') {
        if (isDiscoveryObservation(message.payload)) {
            discoveryRing.push(message.payload);
            if (discoveryRing.length > 100)
                discoveryRing.splice(0, discoveryRing.length - 100);
        }
        sendResponse({ ok: true });
        return;
    }
    if (message.type === 'GET_DISCOVERY_OBSERVATIONS') {
        sendResponse({ observations: [...discoveryRing] });
        return;
    }
    if (message.type === 'GET_ANALYTICS') {
        void runtime.then(async ({ journal, pipeline }) => {
            const nowMs = Date.now();
            await pipeline.watchdog(nowMs);
            const [snapshot, health] = await Promise.all([journal.snapshot(), Promise.resolve(pipeline.getOperationalHealth(nowMs))]);
            sendResponse(computeAnalytics(snapshot, health, pipeline.getAllAssetFeedOperationalHealth(nowMs), latestCapture(), pipeline.getActiveEpisodeCount(nowMs)));
        }).catch((error) => sendResponse({ error: error instanceof Error ? error.message : 'analytics failure' }));
        return true;
    }
    if (message.type === 'EXPORT_DATASET_JSON') {
        void runtime.then(async ({ journal, pipeline, buildMetadata }) => {
            const createdAt = Date.now();
            await pipeline.finalizeThrough(createdAt);
            const operationalHealth = pipeline.getOperationalHealth(createdAt);
            const exporter = new DatasetExporter(journal);
            const dataset = await exporter.create({
                ...buildMetadata,
                createdAt,
                operationalHealth,
                assetFeedHealth: pipeline.getAllAssetFeedOperationalHealth(createdAt),
                captureTransport: latestCapture(),
            });
            sendResponse({ filename: `otc-elite-dataset-${dataset.manifest.datasetId.slice(0, 12)}.json`, json: JSON.stringify(dataset, null, 2) });
        }).catch((error) => sendResponse({ error: error instanceof Error ? error.message : 'export failure' }));
        return true;
    }
});
