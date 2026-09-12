import { isSemanticPayoutEvent, isSemanticPriceEvent } from '../../common/validation/semantic-event-validator.js';
import { createValidatedTick } from '../../common/validation/tick-factory.js';
import { computeAnalytics } from '../evaluation/analytics.js';
import { DatasetExporter } from '../export/dataset-exporter.js';
import { IndexedDbJournal, openJournalDatabase } from '../storage/indexeddb-journal.js';
import { DEFAULT_PIPELINE_CONFIG, QuantPipeline } from './quant-pipeline.js';
const WATCHDOG_ALARM_NAME = 'otc-elite-data-health-watchdog';
const WATCHDOG_PERIOD_MINUTES = 0.5;
const discoveryRing = [];
function isRecord(value) {
    return typeof value === 'object' && value !== null;
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
        return {
            appVersion: fallbackVersion,
            buildId: 'runtime-metadata-unavailable',
            sourceTreeSha256: null,
            gitCommit: null,
            gitWorkingTreeClean: null,
        };
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
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRecord(message))
        return;
    if (message.type === 'SEMANTIC_EVENT_BATCH') {
        const payload = message.payload;
        if (!Array.isArray(payload))
            return;
        void runtime.then(async ({ pipeline }) => {
            for (const item of payload) {
                if (!isRecord(item) || typeof item.pageSessionId !== 'string')
                    continue;
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
            sendResponse({ ok: true });
        }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'runtime failure' }));
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
            const [snapshot, health] = await Promise.all([
                journal.snapshot(),
                Promise.resolve(pipeline.getOperationalHealth(nowMs)),
            ]);
            sendResponse(computeAnalytics(snapshot, health));
        }).catch((error) => sendResponse({ error: error instanceof Error ? error.message : 'analytics failure' }));
        return true;
    }
    if (message.type === 'EXPORT_DATASET_JSON') {
        void runtime.then(async ({ journal, pipeline, buildMetadata }) => {
            const createdAt = Date.now();
            await pipeline.finalizeThrough(createdAt);
            const operationalHealth = pipeline.getOperationalHealth(createdAt);
            const exporter = new DatasetExporter(journal);
            const dataset = await exporter.create({ ...buildMetadata, createdAt, operationalHealth });
            sendResponse({ filename: `otc-elite-dataset-${dataset.manifest.datasetId.slice(0, 12)}.json`, json: JSON.stringify(dataset, null, 2) });
        }).catch((error) => sendResponse({ error: error instanceof Error ? error.message : 'export failure' }));
        return true;
    }
});
