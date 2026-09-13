import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
import type { CaptureTransportSnapshot, ShadowFeedState, SourceTabVisibility, TransportEventRecord, TransportEventType } from '../../common/models/runtime-telemetry.js';
import type { DiscoveryObservation } from '../../common/protocol/market-events.js';
import { isSemanticPayoutEvent, isSemanticPriceEvent } from '../../common/validation/semantic-event-validator.js';
import { createValidatedTick } from '../../common/validation/tick-factory.js';
import { computeAnalytics } from '../evaluation/analytics.js';
import { DatasetExporter } from '../export/dataset-exporter.js';
import { IndexedDbJournal, openJournalDatabase } from '../storage/indexeddb-journal.js';
import { Phase4ValidationEngine } from '../../scientific-validation/phase4/engine.js';
import { IndexedDbPhase4Repository, openPhase4Database } from '../../scientific-validation/phase4/indexeddb-repository.js';
import { DEFAULT_PIPELINE_CONFIG, QuantPipeline } from './quant-pipeline.js';

interface BuildMetadata {
  appVersion: string;
  buildId: string;
  sourceTreeSha256: string | null;
  scientificCoreSha256: string | null;
  gitCommit: string | null;
  gitWorkingTreeClean: boolean | null;
  gitProvenance: 'GIT' | 'ENVIRONMENT' | 'UNAVAILABLE';
}

interface RuntimeContext {
  journal: IndexedDbJournal;
  pipeline: QuantPipeline;
  buildMetadata: BuildMetadata;
  phase4: Phase4ValidationEngine;
}

const WATCHDOG_ALARM_NAME = 'otc-elite-data-health-watchdog';
const WATCHDOG_PERIOD_MINUTES = 0.5;
const SEMANTIC_PORT_NAME = 'OTC_ELITE_SEMANTIC_STREAM_V1';
const discoveryRing: DiscoveryObservation[] = [];
const captureByTab = new Map<number, CaptureTransportSnapshot>();
const capturePortByTab = new Map<number, chrome.runtime.Port>();
let latestCaptureTabId: number | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function defaultCapture(tabId: number | null): CaptureTransportSnapshot {
  return {
    transportSchemaVersion: '4',
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
    shadowPrimary: false,
    shadowState: 'WAITING_CONTEXT',
    shadowEndpointHost: null,
    shadowReconnectAttempts: 0,
    shadowConsecutiveNamespaceRejects: 0,
    shadowCircuitOpen: false,
    shadowLastMessageAt: null,
    shadowLastPriceAt: null,
    shadowLastErrorReason: null,
    shadowLastCommandAt: null,
    mitigation: 'MAIN_WORLD_NATIVE_SHADOW_RUNTIME_PORT_WATCHDOG_AUTO_DISCARD_DISABLED',
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


async function loadBuildMetadata(): Promise<BuildMetadata> {
  const fallbackVersion = chrome.runtime.getManifest().version;
  try {
    const response = await fetch(chrome.runtime.getURL('build-metadata.json'));
    if (!response.ok) throw new Error(`build metadata HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!isRecord(value)) throw new Error('build metadata is not an object');
    const sourceTreeSha256 = value.sourceTreeSha256;
    const scientificCoreSha256 = value.scientificCoreSha256;
    const gitCommit = value.gitCommit;
    const gitWorkingTreeClean = value.gitWorkingTreeClean;
    const gitProvenance = value.gitProvenance;
    if (typeof value.appVersion !== 'string' || typeof value.buildId !== 'string') throw new Error('build metadata identity missing');
    if (sourceTreeSha256 !== null && typeof sourceTreeSha256 !== 'string') throw new Error('invalid sourceTreeSha256');
    if (scientificCoreSha256 !== null && typeof scientificCoreSha256 !== 'string') throw new Error('invalid scientificCoreSha256');
    if (gitCommit !== null && typeof gitCommit !== 'string') throw new Error('invalid gitCommit');
    if (gitWorkingTreeClean !== null && typeof gitWorkingTreeClean !== 'boolean') throw new Error('invalid gitWorkingTreeClean');
    if (gitProvenance !== 'GIT' && gitProvenance !== 'ENVIRONMENT' && gitProvenance !== 'UNAVAILABLE') throw new Error('invalid gitProvenance');
    return { appVersion: value.appVersion, buildId: value.buildId, sourceTreeSha256, scientificCoreSha256, gitCommit, gitWorkingTreeClean, gitProvenance };
  } catch {
    return { appVersion: fallbackVersion, buildId: 'runtime-metadata-unavailable', sourceTreeSha256: null, scientificCoreSha256: null, gitCommit: null, gitWorkingTreeClean: null, gitProvenance: 'UNAVAILABLE' };
  }
}

const runtime = (async (): Promise<RuntimeContext> => {
  const [db, phase4Db, buildMetadata] = await Promise.all([openJournalDatabase(), openPhase4Database(), loadBuildMetadata()]);
  const journal = new IndexedDbJournal(db);
  const phase4 = new Phase4ValidationEngine(new IndexedDbPhase4Repository(phase4Db));
  const pipeline = new QuantPipeline(journal, { ...DEFAULT_PIPELINE_CONFIG, appVersion: buildMetadata.appVersion });
  await pipeline.initialize(Date.now());
  chrome.alarms.create(WATCHDOG_ALARM_NAME, { periodInMinutes: WATCHDOG_PERIOD_MINUTES });
  return { journal, pipeline, buildMetadata, phase4 };
})();

function latestCaptureBase(): CaptureTransportSnapshot {
  if (latestCaptureTabId !== null) return captureByTab.get(latestCaptureTabId) ?? defaultCapture(null);
  const latest = [...captureByTab.values()].sort((a, b) => (b.lastSemanticEventAt ?? b.lastLifecycleEventAt ?? 0) - (a.lastSemanticEventAt ?? a.lastLifecycleEventAt ?? 0))[0];
  return latest ?? defaultCapture(null);
}

function latestCapture(): CaptureTransportSnapshot { return { ...latestCaptureBase() }; }

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
    transportEventSchemaVersion: '3',
    transportEventId: canonicalEntityHash('TRANSPORT_EVENT', 2, input),
    ...input,
  };
  const { journal } = await runtime;
  await journal.appendTransportEvent(event);
}


chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== WATCHDOG_ALARM_NAME) return;
  const nowMs = Date.now();
  superviseShadowConnections(nowMs, true);
  void runtime.then(({ pipeline }) => pipeline.watchdog(nowMs)).catch(() => undefined);
});

function isDiscoveryObservation(value: unknown): value is DiscoveryObservation {
  if (!isRecord(value)) return false;
  return value.type === 'DISCOVERY_OBSERVATION'
    && typeof value.connectionId === 'string'
    && typeof value.byteLength === 'number'
    && (value.direction === 'INBOUND' || value.direction === 'OUTBOUND');
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
      if (tabId !== null && item.event.connectionId.startsWith('shadow-main-')) {
        const state = captureState(tabId);
        state.shadowConnected = true;
        state.shadowPrimary = true;
        state.shadowState = 'STREAMING';
        state.shadowLastMessageAt = item.event.receivedAtEpochMs;
        state.shadowLastPriceAt = item.event.receivedAtEpochMs;
        state.shadowLastErrorReason = null;
      }
      const tick = createValidatedTick(item.event, item.pageSessionId);
      if (tick.integrity !== 'VALID') continue;
      await pipeline.enqueue({ tick });
      continue;
    }
    if (isSemanticPayoutEvent(item.event)) {
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
  if (state.visibility === 'hidden' && !state.shadowCircuitOpen) sendShadowControl(tabId, 'ENSURE_CONNECTED', state.lastLifecycleEventAt);
}

function processConnectionEvent(payload: unknown, tabId: number | null): void {
  if (tabId === null || !isRecord(payload) || !isRecord(payload.event)) return;
  const pageSessionId = typeof payload.pageSessionId === 'string' ? payload.pageSessionId : null;
  const capturedAt = typeof payload.capturedAt === 'number' ? payload.capturedAt : Date.now();
  const connection = payload.event;
  const connectionId = typeof connection.connectionId === 'string' ? connection.connectionId : null;
  const role = connection.transportRole;
  const event = connection.event;
  const host = connection.feedHost === null || typeof connection.feedHost === 'string' ? connection.feedHost : null;
  if (!connectionId || (role !== 'PAGE' && role !== 'SHADOW') || (event !== 'OPEN' && event !== 'CLOSE' && event !== 'ERROR')) return;
  const state = captureState(tabId);
  state.lastConnectionEventAt = capturedAt;
  state.connected = true;
  state.pageSessionId = pageSessionId ?? state.pageSessionId;
  latestCaptureTabId = tabId;

  const eventType: TransportEventType = role === 'SHADOW'
    ? event === 'OPEN' ? 'SHADOW_WS_OPEN' : event === 'CLOSE' ? 'SHADOW_WS_CLOSE' : 'SHADOW_WS_ERROR'
    : event === 'OPEN' ? 'PAGE_WS_OPEN' : event === 'CLOSE' ? 'PAGE_WS_CLOSE' : 'PAGE_WS_ERROR';

  if (role === 'PAGE') {
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
  }

  if (event === 'OPEN') return;

  const shadowHealthy = state.shadowConnected
    && state.shadowPrimary
    && state.shadowState === 'STREAMING'
    && state.shadowLastPriceAt !== null
    && capturedAt - state.shadowLastPriceAt <= 15_000;

  if (role === 'PAGE' && shadowHealthy) return;

  void runtime.then(({ pipeline }) => pipeline.connectionLost(connectionId, capturedAt, eventType)).catch(() => undefined);

  if (role === 'PAGE' && !state.shadowCircuitOpen) {
    sendShadowControl(tabId, 'ENSURE_CONNECTED', capturedAt);
  }
}

function isShadowFeedState(value: unknown): value is ShadowFeedState {
  return value === 'WAITING_CONTEXT' || value === 'ENGINE_CONNECTING' || value === 'ENGINE_OPEN' || value === 'NAMESPACE_CONNECTING' || value === 'NAMESPACE_OPEN' || value === 'AUTH_SENT' || value === 'AUTHENTICATED' || value === 'SUBSCRIPTIONS_REPLAYED' || value === 'STREAMING' || value === 'BACKOFF' || value === 'CIRCUIT_OPEN' || value === 'ERROR';
}

function processShadowTransport(payload: unknown, tabId: number | null): void {
  if (tabId === null || !isRecord(payload) || payload.type !== 'SHADOW_TRANSPORT') return;
  if (typeof payload.eventType !== 'string' || typeof payload.occurredAt !== 'number' || !isShadowFeedState(payload.state)) return;
  const state = captureState(tabId);
  state.pageSessionId = typeof payload.pageSessionId === 'string' ? payload.pageSessionId : state.pageSessionId;
  state.shadowConnected = payload.connected === true;
  state.shadowPrimary = payload.primary === true;
  state.shadowState = payload.state;
  state.shadowEndpointHost = typeof payload.endpointHost === 'string' ? payload.endpointHost : null;
  state.shadowReconnectAttempts = typeof payload.reconnectAttempts === 'number' ? payload.reconnectAttempts : state.shadowReconnectAttempts;
  state.shadowConsecutiveNamespaceRejects = typeof payload.consecutiveNamespaceRejects === 'number' ? payload.consecutiveNamespaceRejects : state.shadowConsecutiveNamespaceRejects;
  state.shadowCircuitOpen = payload.circuitOpen === true;
  state.shadowLastMessageAt = typeof payload.lastMessageAt === 'number' ? payload.lastMessageAt : state.shadowLastMessageAt;
  state.shadowLastPriceAt = typeof payload.lastPriceAt === 'number' ? payload.lastPriceAt : state.shadowLastPriceAt;
  state.shadowLastErrorReason = typeof payload.lastErrorReason === 'string' ? payload.lastErrorReason : null;
  const eventType = payload.eventType as TransportEventType;
  queueTransportEvent({
    eventType,
    occurredAt: payload.occurredAt,
    tabId,
    pageSessionId: state.pageSessionId,
    connectionId: typeof payload.connectionId === 'string' ? payload.connectionId : null,
    endpointHost: state.shadowEndpointHost,
    visibility: state.visibility,
    shadow: true,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
  });
}

function sendShadowControl(tabId: number, command: 'ENSURE_CONNECTED' | 'FORCE_RECONNECT' | 'RESET_CIRCUIT', nowMs: number): void {
  const port = capturePortByTab.get(tabId);
  if (!port) return;
  const state = captureState(tabId);
  if (state.shadowLastCommandAt !== null && nowMs - state.shadowLastCommandAt < 10_000 && command !== 'RESET_CIRCUIT') return;
  try {
    port.postMessage({ type: 'SHADOW_CONTROL', command, sentAt: nowMs });
    state.shadowLastCommandAt = nowMs;
  } catch { return; }
}

function superviseShadowConnections(nowMs: number, alarmDriven: boolean): void {
  for (const [tabId, state] of captureByTab) {
    if (!state.connected || state.discarded === true || state.frozen === true || state.shadowCircuitOpen) continue;
    const shadowPriceAge = state.shadowLastPriceAt === null ? Number.POSITIVE_INFINITY : nowMs - state.shadowLastPriceAt;

    if (state.shadowState === 'STREAMING' && state.shadowConnected && shadowPriceAge > 15_000) {
      sendShadowControl(tabId, 'FORCE_RECONNECT', nowMs);
      continue;
    }

    if (!state.shadowConnected && (state.shadowState === 'WAITING_CONTEXT' || state.shadowState === 'ERROR')) {
      sendShadowControl(tabId, 'ENSURE_CONNECTED', nowMs);
      continue;
    }

    if (alarmDriven && state.shadowState === 'WAITING_CONTEXT') sendShadowControl(tabId, 'ENSURE_CONNECTED', nowMs);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SEMANTIC_PORT_NAME) return;
  const tabId = port.sender?.tab?.id ?? null;
  if (tabId !== null) {
    capturePortByTab.set(tabId, port);
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
    if (message.type === 'SHADOW_TRANSPORT_EVENT') { processShadowTransport(message.payload, tabId); return; }
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
    if (capturePortByTab.get(tabId) === port) capturePortByTab.delete(tabId);
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
  capturePortByTab.delete(tabId);
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
    superviseShadowConnections(nowMs, false);
    void runtime.then(async ({ journal, pipeline, buildMetadata, phase4 }) => {
      await pipeline.watchdog(nowMs);
      await flushTransportEvents();
      const [snapshot, health] = await Promise.all([journal.snapshot(), Promise.resolve(pipeline.getOperationalHealth(nowMs))]);
      const phase4Report = await phase4.syncLiveJournal(snapshot, buildMetadata, nowMs);
      const analytics = computeAnalytics(
        snapshot,
        health,
        pipeline.getAllAssetFeedOperationalHealth(nowMs),
        latestCapture(),
        pipeline.getActiveEpisodeCount(nowMs),
        DEFAULT_PIPELINE_CONFIG.strictSettlementMaxTimingErrorMs,
        DEFAULT_PIPELINE_CONFIG.maxExpiryResolutionDelayMs,
      );
      sendResponse({
        ...analytics,
        buildId: buildMetadata.buildId,
        sourceTreeSha256: buildMetadata.sourceTreeSha256,
        gitCommit: buildMetadata.gitCommit,
        gitWorkingTreeClean: buildMetadata.gitWorkingTreeClean,
        gitProvenance: buildMetadata.gitProvenance,
        scientificBuildProvenanceReady: buildMetadata.gitCommit !== null && buildMetadata.gitProvenance !== 'UNAVAILABLE',
        scientificCoreSha256: buildMetadata.scientificCoreSha256,
        phase4: phase4Report,
      });
    }).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'analytics failure' }));
    return true;
  }

  if (message.type === 'START_PHASE4') {
    const nowMs = Date.now();
    void runtime.then(async ({ journal, buildMetadata, phase4 }) => {
      const experiment = await phase4.startExperiment(await journal.snapshot(), buildMetadata, nowMs);
      const report = await phase4.syncLiveJournal(await journal.snapshot(), buildMetadata, nowMs);
      sendResponse({ experiment, report });
    }).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'Phase 4 start failure' }));
    return true;
  }

  if (message.type === 'IMPORT_PHASE4_DATASET_JSON') {
    if (typeof message.json !== 'string') {
      sendResponse({ error: 'Phase 4 dataset JSON missing' });
      return;
    }
    void runtime.then(async ({ phase4 }) => {
      const report = await phase4.importDatasetJson(message.json as string, Date.now());
      sendResponse({ report });
    }).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'Phase 4 import failure' }));
    return true;
  }

  if (message.type === 'EXPORT_PHASE4_REPORT_JSON') {
    void runtime.then(async ({ phase4 }) => {
      const report = await phase4.report();
      if (!report.experiment) throw new Error('Phase 4 has not started');
      sendResponse({ filename: `phase4-${report.experiment.experimentId}-report.json`, json: JSON.stringify(report, null, 2) });
    }).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'Phase 4 report export failure' }));
    return true;
  }

  if (message.type === 'EXPORT_DATASET_JSON') {
    const nowMs = Date.now();
    superviseShadowConnections(nowMs, false);
    void runtime.then(async ({ journal, pipeline, buildMetadata, phase4 }) => {
      if (buildMetadata.gitCommit === null || buildMetadata.gitProvenance === 'UNAVAILABLE') {
        throw new Error('Scientific dataset export blocked: Git provenance unavailable. Run npm run verify inside the Git checkout, reload the extension, and export again.');
      }
      const createdAt = Date.now();
      await pipeline.finalizeThrough(createdAt);
      await flushTransportEvents();
      const operationalHealth = pipeline.getOperationalHealth(createdAt);
      const exporter = new DatasetExporter(journal);
      await phase4.syncLiveJournal(await journal.snapshot(), buildMetadata, createdAt);
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
