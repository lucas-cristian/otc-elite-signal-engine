import type { DiscoveryObservation } from '../../common/protocol/market-events.js';
import { isSemanticPayoutEvent, isSemanticPriceEvent } from '../../common/validation/semantic-event-validator.js';
import { createValidatedTick } from '../../common/validation/tick-factory.js';
import { computeAnalytics } from '../evaluation/analytics.js';
import { DatasetExporter } from '../export/dataset-exporter.js';
import { QuantPipeline, DEFAULT_PIPELINE_CONFIG } from './quant-pipeline.js';
import { IndexedDbJournal, openJournalDatabase } from '../storage/indexeddb-journal.js';

interface RuntimeContext {
  journal: IndexedDbJournal;
  pipeline: QuantPipeline;
}

const discoveryRing: DiscoveryObservation[] = [];

const runtime = (async (): Promise<RuntimeContext> => {
  const db = await openJournalDatabase();
  const journal = new IndexedDbJournal(db);
  const pipeline = new QuantPipeline(journal, DEFAULT_PIPELINE_CONFIG);
  await pipeline.initialize(Date.now());
  return { journal, pipeline };
})();

function isDiscoveryObservation(value: unknown): value is DiscoveryObservation {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === 'DISCOVERY_OBSERVATION'
    && typeof record.connectionId === 'string'
    && typeof record.byteLength === 'number'
    && (record.direction === 'INBOUND' || record.direction === 'OUTBOUND');
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== 'object' || message === null) return;
  const record = message as Record<string, unknown>;

  if (record.type === 'SEMANTIC_EVENT_BATCH') {
    const payload = record.payload;
    if (!Array.isArray(payload)) return;
    void runtime.then(async ({ pipeline }) => {
      for (const item of payload) {
        if (typeof item !== 'object' || item === null) continue;
        const envelope = item as Record<string, unknown>;
        if (typeof envelope.pageSessionId !== 'string') continue;
        if (isSemanticPriceEvent(envelope.event)) {
          const tick = createValidatedTick(envelope.event, envelope.pageSessionId);
          if (tick.integrity !== 'VALID') continue;
          await pipeline.enqueue({ tick });
          continue;
        }
        if (isSemanticPayoutEvent(envelope.event)) await pipeline.enqueuePayout(envelope.event.payoutSnapshot);
      }
      await pipeline.drain();
      sendResponse({ ok: true });
    }).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'runtime failure' }));
    return true;
  }

  if (record.type === 'PROTOCOL_DISCOVERY_OBSERVATION') {
    if (isDiscoveryObservation(record.payload)) {
      discoveryRing.push(record.payload);
      if (discoveryRing.length > 100) discoveryRing.splice(0, discoveryRing.length - 100);
    }
    sendResponse({ ok: true });
    return;
  }

  if (record.type === 'GET_DISCOVERY_OBSERVATIONS') {
    sendResponse({ observations: [...discoveryRing] });
    return;
  }

  if (record.type === 'GET_ANALYTICS') {
    void runtime.then(async ({ journal }) => sendResponse(computeAnalytics(await journal.snapshot())))
      .catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'analytics failure' }));
    return true;
  }

  if (record.type === 'EXPORT_DATASET_JSON') {
    void runtime.then(async ({ journal, pipeline }) => {
      await pipeline.drain();
      const exporter = new DatasetExporter(journal);
      const dataset = await exporter.create({ appVersion: '1.2.0', buildId: 'local-tsc', gitCommit: null, createdAt: Date.now() });
      sendResponse({ filename: `otc-elite-dataset-${dataset.manifest.datasetId.slice(0, 12)}.json`, json: JSON.stringify(dataset, null, 2) });
    }).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'export failure' }));
    return true;
  }
});
