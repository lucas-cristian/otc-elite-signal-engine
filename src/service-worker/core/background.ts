import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
import type { CaptureTransportSnapshot, SourceTabVisibility, TransportEventRecord, TransportEventType } from '../../common/models/runtime-telemetry.js';
import type { DiscoveryObservation, RecoveryContextEvent, SemanticMarketEvent } from '../../common/protocol/market-events.js';
import { isSemanticPayoutEvent, isSemanticPriceEvent } from '../../common/validation/semantic-event-validator.js';
import { createValidatedTick } from '../../common/validation/tick-factory.js';
import { computeAnalytics } from '../evaluation/analytics.js';
import { DatasetExporter } from '../export/dataset-exporter.js';
import { IndexedDbJournal, openJournalDatabase } from '../storage/indexeddb-journal.js';
import { DEFAULT_PIPELINE_CONFIG, QuantPipeline } from './quant-pipeline.js';
import { ShadowMarketConnection, type ShadowRecoveryContext, type ShadowTransportEvent } from './shadow-market-connection.js';

interface BuildMetadata {
  appVersion: string;
  buildId: string;
  sourceTreeSha256: string | null;
  gitCommit: string | null;
  gitWorkingTreeClean: boolean | null;
}

interface RuntimeContext {
  journal: IndexedDbJournal;
  pipeline: QuantPipeline;
  buildMetadata: BuildMetadata;
}

const WATCHDOG_ALARM_NAME = 'otc-elite-data-health-watchdog';
const WATCHDOG_PERIOD_MINUTES = 0.5;
const SEMANTIC_PORT_NAME = 'OTC_ELITE_SEMANTIC_STREAM_V1';
const discoveryRing: DiscoveryObservation[] = [];
const captureByTab = new Map<number, CaptureTransportSnapshot>();
let latestCaptureTabId: number | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function defaultCapture(tabId: number | null): CaptureTransportSnapshot {
  return {
    transportSchemaVersion: '2',
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
    shadowConnected: false,
    shadowState: 'WAITING_CONTEXT',
    shadowEndpointHost: null,
    shadowReconnectAttempts: 0,
    shadowLastMessageAt: null,
    shadowLastPriceAt: null,
    shadowLastErrorReason: null,
    mitigation: 'RUNTIME_PORT_MICROTASK_FLUSH_AUTO_DISCARD_DISABLED_SHADOW_WS',
  };
}

function captureState(tabId: number): CaptureTransportSnapshot {
  const existing = captureByTab.get(tabId);
  if (existing) return existing;
  const created = defaultCapture(tabId);
  captureByTab.set(tabId, created);
  return created;
}

function visibility(value: unknown): SourceTabVisibility {
  return value === 'visible' || value === 'hidden' || value === 'prerender' ? value : 'unknown';
}

function endpointHost(endpointUrl: string | null): string | null {
  if (endpointUrl === null) return null;
  try {
    return new URL(endpointUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function loadBuildMetadata(): Promise<BuildMetadata> {
  const fallbackVersion = chrome.runtime.getManifest().version;
  try {
    const response = await fetch(chrome.runtime.getURL('build-metadata.json'));
    if (!response.ok) throw new Error(`build metadata HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!isRecord(value)) throw new Error('build metadata is not an object');
    const sourceTreeSha256 = value.sourceTreeSha256;
    const gitCommit = value.gitCommit;
    const gitWorkingTreeClean = value.gitWorkingTreeClean;
    if (typeof value.appVersion !== 'string' || typeof value.buildId !== 'string') throw new Error('build metadata identity missing');
    if (sourceTreeSha256 !== null && typeof sourceTreeSha256 !== 'string') throw new Error('invalid sourceTreeSha256');
    if (gitCommit !== null && typeof gitCommit !== 'string') throw new Error('invalid gitCommit');
    if (gitWorkingTreeClean !== null && typeof gitWorkingTreeClean !== 'boolean') throw new Error('invalid gitWorkingTreeClean');
    return { appVersion: value.appVersion, buildId: value.buildId, sourceTreeSha256, gitCommit, gitWorkingTreeClean };
  } catch {
    return { appVersion: fallbackVersion, buildId: 'runtime-metadata-unavailable', sourceTreeSha256: null, gitCommit: null, gitWorkingTreeClean: null };
  }
}

const runtime = (async (): Promise<RuntimeContext> => {
  const [db, buildMetadata] = await Promise.all([openJournalDatabase(), loadBuildMetadata()]);
  const journal = new IndexedDbJournal(db);
  const pipeline = new QuantPipeline(journal, { ...DEFAULT_PIPELINE_CONFIG, appVersion: buildMetadata.appVersion });
  await pipeline.initialize(Date.now());
  chrome.alarms.create(WATCHDOG_ALARM_NAME, { periodInMinutes: WATCHDOG_PERIOD_MINUTES });
  return { journal, pipeline, buildMetadata };
})();

function latestCaptureBase(): CaptureTransportSnapshot {
  if (latestCaptureTabId !== null) return captureByTab.get(latestCaptureTabId) ?? defaultCapture(null);
  const latest = [...captureByTab.values()].sort((a, b) => (b.lastSemanticEventAt ?? b.lastLifecycleEventAt ?? 0) - (a.lastSemanticEventAt ?? a.lastLifecycleEventAt ?? 0))[0];
  return latest ?? defaultCapture(null);
}

function latestCapture(): CaptureTransportSnapshot {
  const base = latestCaptureBase();
  const shadow = shadowConnection.snapshot();
  return {
    ...base,
    shadowConnected: shadow.connected,
    shadowState: shadow.state,
    shadowEndpointHost: shadow.endpointHost,
    shadowReconnectAttempts: shadow.reconnectAttempts,
    shadowLastMessageAt: shadow.lastMessageAt,
    shadowLastPriceAt: shadow.lastPriceAt,
    shadowLastErrorReason: shadow.lastErrorReason,
  };
}

let transportWriteQueue: Promise<void> = Promise.resolve();

function queueTransportEvent(input: Parameters<typeof appendTransportEvent>[0]): void {
  transportWriteQueue = transportWriteQueue.then(() => appendTransportEvent(input)).catch(() => undefined);
}

async function flushTransportEvents(): Promise<void> {
  await transportWriteQueue;
}

async function appendTransportEvent(input: {
  eventType: TransportEventType;
  occurredAt: number;
  tabId: number | null;
  pageSessionId: string | null;
  connectionId: string | null;
  endpointHost: string | null;
  visibility: SourceTabVisibility;
  shadow: boolean;
  reason: string | null;
}): Promise<void> {
  const event: TransportEventRecord = {
    transportEventSchemaVersion: '1',
    transportEventId: canonicalEntityHash('TRANSPORT_EVENT', 1, input),
    ...input,
  };
  const { journal } = await runtime;
  await journal.appendTransportEvent(event);
}

async function processShadowSemanticEvent(event: SemanticMarketEvent, pageSessionId: string): Promise<void> {
  const { pipeline } = await runtime;
  if (event.type === 'SEMANTIC_PRICE') {
    const tick = createValidatedTick(event, pageSessionId);
    if (tick.integrity === 'VALID') await pipeline.enqueue({ tick });
  } else {
    await pipeline.enqueuePayout(event.payoutSnapshot);
  }
  await pipeline.drain();
  if (latestCaptureTabId !== null) captureState(latestCaptureTabId).lastSemanticEventAt = Date.now();
}

function processShadowTransportEvent(event: ShadowTransportEvent): void {
  const base = latestCaptureBase();
  queueTransportEvent({
    eventType: event.type,
    occurredAt: event.occurredAt,
    tabId: base.tabId,
    pageSessionId: event.pageSessionId,
    connectionId: event.connectionId,
    endpointHost: event.endpointHost,
    visibility: base.visibility,
    shadow: true,
    reason: event.reason,
  });
  if ((event.type === 'SHADOW_WS_CLOSE' || event.type === 'SHADOW_WS_ERROR' || event.type === 'SHADOW_STALL_DETECTED') && event.connectionId) {
    void runtime.then(({ pipeline }) => pipeline.connectionLost(event.connectionId ?? '', event.occurredAt, event.type)).catch(() => undefined);
  }
}

const shadowConnection = new ShadowMarketConnection({
  onSemanticEvent: processShadowSemanticEvent,
  onTransportEvent: processShadowTransportEvent,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== WATCHDOG_ALARM_NAME) return;
  const nowMs = Date.now();
  shadowConnection.watchdog(nowMs);
  void runtime.then(({ pipeline }) => pipeline.watchdog(nowMs)).catch(() => undefined);
});

function isDiscoveryObservation(value: unknown): value is DiscoveryObservation {
  if (!isRecord(value)) return false;
  return value.type === 'DISCOVERY_OBSERVATION'
    && typeof value.connectionId === 'string'
    && typeof value.byteLength === 'number'
    && (value.direction === 'INBOUND' || value.direction === 'OUTBOUND');
}

function isRecoveryContext(value: unknown): value is ShadowRecoveryContext {
  if (!isRecord(value)) return false;
  return typeof value.pageSessionId === 'string'
    && typeof value.connectionId === 'string'
    && typeof value.endpointUrl === 'string'
    && typeof value.capturedAt === 'number'
    && (value.kind === 'MARKET_ENDPOINT' || value.kind === 'AUTH_PACKET' || value.kind === 'SUBSCRIPTION_PACKET')
    && (value.socketIoEventName === null || typeof value.socketIoEventName === 'string')
    && (value.packet === null || typeof value.packet === 'string');
}

function parseRecoverySnapshot(value: unknown): { pageSessionId: string; endpoint: ShadowRecoveryContext | null; auth: ShadowRecoveryContext | null; subscriptions: ShadowRecoveryContext[] } | null {
  if (!isRecord(value) || typeof value.pageSessionId !== 'string') return null;
  const endpoint = value.endpoint === null ? null : isRecoveryContext(value.endpoint) ? value.endpoint : null;
  const auth = value.auth === null ? null : isRecoveryContext(value.auth) ? value.auth : null;
  const subscriptions = Array.isArray(value.subscriptions) ? value.subscriptions.filter(isRecoveryContext) : [];
  if (!endpoint) return null;
  return { pageSessionId: value.pageSessionId, endpoint, auth, subscriptions };
}

async function processSemanticBatch(payload: unknown, tabId: number | null): Promise<void> {
  if (!Array.isArray(payload)) return;
  const now = Date.now();
  if (tabId !== null) {
    const state = captureState(tabId);
    state.lastSemanticEventAt = now;
    state.connected = true;
    latestCaptureTabId = tabId;
  }
  const { pipeline } = await runtime;
  for (const item of payload) {
    if (!isRecord(item) || typeof item.pageSessionId !== 'string') continue;
    if (tabId !== null) captureState(tabId).pageSessionId = item.pageSessionId;
    if (isSemanticPriceEvent(item.event)) {
      if (shadowConnection.shouldOwnFeed(item.event.identity.feedId, now)) continue;
      const tick = createValidatedTick(item.event, item.pageSessionId);
      if (tick.integrity !== 'VALID') continue;
      await pipeline.enqueue({ tick });
      continue;
    }
    if (isSemanticPayoutEvent(item.event)) {
      const feedId = item.event.payoutSnapshot.feedId;
      if (feedId !== null && shadowConnection.shouldOwnFeed(feedId, now)) continue;
      await pipeline.enqueuePayout(item.event.payoutSnapshot);
    }
  }
  await pipeline.drain();
}

function processLifecycle(payload: unknown, tabId: number | null): void {
  if (tabId === null || !isRecord(payload)) return;
  const state = captureState(tabId);
  if (typeof payload.pageSessionId === 'string') state.pageSessionId = payload.pageSessionId;
  state.visibility = visibility(payload.visibility);
  state.lastLifecycleEventAt = typeof payload.capturedAt === 'number' ? payload.capturedAt : Date.now();
  state.lastLifecycleReason = typeof payload.reason === 'string' ? payload.reason : 'UNKNOWN';
  state.connected = true;
  latestCaptureTabId = tabId;
  queueTransportEvent({
    eventType: 'TAB_LIFECYCLE',
    occurredAt: state.lastLifecycleEventAt,
    tabId,
    pageSessionId: state.pageSessionId,
    connectionId: null,
    endpointHost: null,
    visibility: state.visibility,
    shadow: false,
    reason: state.lastLifecycleReason,
  });
}

function processConnectionEvent(payload: unknown, tabId: number | null): void {
  if (tabId === null || !isRecord(payload) || !isRecord(payload.event)) return;
  const pageSessionId = typeof payload.pageSessionId === 'string' ? payload.pageSessionId : null;
  const capturedAt = typeof payload.capturedAt === 'number' ? payload.capturedAt : Date.now();
  const connection = payload.event;
  const connectionId = typeof connection.connectionId === 'string' ? connection.connectionId : null;
  const event = connection.event;
  const host = connection.feedHost === null || typeof connection.feedHost === 'string' ? connection.feedHost : null;
  if (!connectionId || (event !== 'OPEN' && event !== 'CLOSE' && event !== 'ERROR')) return;
  const state = captureState(tabId);
  state.lastConnectionEventAt = capturedAt;
  state.connected = true;
  state.pageSessionId = pageSessionId ?? state.pageSessionId;
  latestCaptureTabId = tabId;
  const eventType: TransportEventType = event === 'OPEN' ? 'PAGE_WS_OPEN' : event === 'CLOSE' ? 'PAGE_WS_CLOSE' : 'PAGE_WS_ERROR';
  queueTransportEvent({
    eventType,
    occurredAt: capturedAt,
    tabId,
    pageSessionId,
    connectionId,
    endpointHost: host,
    visibility: state.visibility,
    shadow: false,
    reason: null,
  });
  if (event !== 'OPEN') void runtime.then(({ pipeline }) => pipeline.connectionLost(connectionId, capturedAt, eventType)).catch(() => undefined);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SEMANTIC_PORT_NAME) return;
  const tabId = port.sender?.tab?.id ?? null;
  if (tabId !== null) {
    const state = captureState(tabId);
    state.connected = true;
    latestCaptureTabId = tabId;
    queueTransportEvent({
      eventType: 'PORT_CONNECTED',
      occurredAt: Date.now(),
      tabId,
      pageSessionId: state.pageSessionId,
      connectionId: null,
      endpointHost: null,
      visibility: state.visibility,
      shadow: false,
      reason: null,
    });
    void chrome.tabs.update(tabId, { autoDiscardable: false }).then((tab) => {
      const current = captureState(tabId);
      current.autoDiscardable = tab?.autoDiscardable ?? false;
      current.discarded = tab?.discarded ?? current.discarded;
      current.frozen = tab?.frozen ?? current.frozen;
    }).catch(() => undefined);
  }

  port.onMessage.addListener((message) => {
    if (!isRecord(message)) return;
    if (message.type === 'SEMANTIC_EVENT_BATCH') {
      void processSemanticBatch(message.payload, tabId).catch(() => undefined);
      return;
    }
    if (message.type === 'SHADOW_RECOVERY_CONTEXT' && isRecoveryContext(message.payload)) {
      shadowConnection.updateContext(message.payload);
      return;
    }
    if (message.type === 'SHADOW_RECOVERY_SNAPSHOT') {
      const snapshot = parseRecoverySnapshot(message.payload);
      if (snapshot) shadowConnection.replaceSnapshot(snapshot);
      return;
    }
    if (message.type === 'PROTOCOL_DISCOVERY_OBSERVATION') {
      if (isDiscoveryObservation(message.payload)) {
        discoveryRing.push(message.payload);
        if (discoveryRing.length > 100) discoveryRing.splice(0, discoveryRing.length - 100);
      }
      return;
    }
    if (message.type === 'SOURCE_TAB_LIFECYCLE') {
      processLifecycle(message.payload, tabId);
      return;
    }
    if (message.type === 'SOURCE_CONNECTION_EVENT') processConnectionEvent(message.payload, tabId);
  });

  port.onDisconnect.addListener(() => {
    if (tabId === null) return;
    const state = captureState(tabId);
    state.connected = false;
    queueTransportEvent({
      eventType: 'PORT_DISCONNECTED',
      occurredAt: Date.now(),
      tabId,
      pageSessionId: state.pageSessionId,
      connectionId: null,
      endpointHost: null,
      visibility: state.visibility,
      shadow: false,
      reason: null,
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!captureByTab.has(tabId)) return;
  const state = captureState(tabId);
  if (typeof changeInfo.frozen === 'boolean') state.frozen = changeInfo.frozen;
  if (typeof changeInfo.discarded === 'boolean') state.discarded = changeInfo.discarded;
  if (typeof changeInfo.autoDiscardable === 'boolean') state.autoDiscardable = changeInfo.autoDiscardable;
  if (tab.autoDiscardable === true) void chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  captureByTab.delete(tabId);
  if (latestCaptureTabId === tabId) latestCaptureTabId = null;
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRecord(message)) return;

  if (message.type === 'SEMANTIC_EVENT_BATCH') {
    void processSemanticBatch(message.payload, sender.tab?.id ?? null)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'runtime failure' }));
    return true;
  }

  if (message.type === 'PROTOCOL_DISCOVERY_OBSERVATION') {
    if (isDiscoveryObservation(message.payload)) {
      discoveryRing.push(message.payload);
      if (discoveryRing.length > 100) discoveryRing.splice(0, discoveryRing.length - 100);
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'GET_DISCOVERY_OBSERVATIONS') {
    sendResponse({ observations: [...discoveryRing] });
    return;
  }

  if (message.type === 'GET_ANALYTICS') {
    const nowMs = Date.now();
    shadowConnection.watchdog(nowMs);
    void runtime.then(async ({ journal, pipeline }) => {
      await pipeline.watchdog(nowMs);
      await flushTransportEvents();
      const [snapshot, health] = await Promise.all([journal.snapshot(), Promise.resolve(pipeline.getOperationalHealth(nowMs))]);
      sendResponse(computeAnalytics(snapshot, health, pipeline.getAllAssetFeedOperationalHealth(nowMs), latestCapture(), pipeline.getActiveEpisodeCount(nowMs)));
    }).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'analytics failure' }));
    return true;
  }

  if (message.type === 'EXPORT_DATASET_JSON') {
    const nowMs = Date.now();
    shadowConnection.watchdog(nowMs);
    void runtime.then(async ({ journal, pipeline, buildMetadata }) => {
      const createdAt = Date.now();
      await pipeline.finalizeThrough(createdAt);
      await flushTransportEvents();
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
    }).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'export failure' }));
    return true;
  }
});
