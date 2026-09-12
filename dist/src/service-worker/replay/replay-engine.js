import { canonicalJson } from '../../common/hashing/canonical-hash.js';
import { sha256 } from '../../common/hashing/sha256.js';
import { QuantPipeline } from '../core/quant-pipeline.js';
import { DatasetExporter } from '../export/dataset-exporter.js';
import { MemoryJournal } from '../storage/memory-journal.js';
export class ReplayEngine {
    async replay(dataset, config) {
        this.verifyChecksum(dataset);
        const journal = new MemoryJournal();
        const pipeline = new QuantPipeline(journal, { ...config, executionMode: 'REPLAY' });
        const firstTimestamp = dataset.ticks[0]?.receivedAtEpochMs ?? dataset.manifest.createdAt;
        await pipeline.initialize(firstTimestamp);
        const items = [
            ...dataset.payoutSnapshots.map((payout) => ({ type: 'PAYOUT', timestamp: payout.capturedAt, payout })),
            ...dataset.ticks.map((tick) => ({ type: 'TICK', timestamp: tick.receivedAtEpochMs, tick })),
        ].sort((a, b) => a.timestamp - b.timestamp || (a.type === 'PAYOUT' ? -1 : 1));
        for (const item of items) {
            if (item.type === 'PAYOUT')
                await pipeline.enqueuePayout(item.payout);
            else
                await pipeline.enqueue({ tick: item.tick });
        }
        await pipeline.drain();
        await pipeline.finalizeThrough(dataset.manifest.createdAt);
        const operationalHealth = pipeline.getOperationalHealth(dataset.manifest.createdAt);
        return new DatasetExporter(journal).create({
            appVersion: dataset.manifest.appVersion,
            buildId: `${dataset.manifest.buildId}:replay`,
            sourceTreeSha256: dataset.manifest.sourceTreeSha256 ?? null,
            gitCommit: dataset.manifest.gitCommit,
            gitWorkingTreeClean: dataset.manifest.gitWorkingTreeClean ?? null,
            createdAt: dataset.manifest.createdAt,
            operationalHealth,
            assetFeedHealth: pipeline.getAllAssetFeedOperationalHealth(dataset.manifest.createdAt),
            captureTransport: dataset.manifest.captureTransportAtExport,
        });
    }
    verifyChecksum(dataset) {
        const body = {
            ticks: dataset.ticks,
            payoutSnapshots: dataset.payoutSnapshots,
            candles: dataset.candles,
            decisions: dataset.decisions,
            entryResolutions: dataset.entryResolutions,
            decisionSignalLinks: dataset.decisionSignalLinks,
            signals: dataset.signals,
            results: dataset.results,
            continuityEvents: dataset.continuityEvents,
            transportEvents: dataset.transportEvents,
        };
        const checksum = sha256(new TextEncoder().encode(canonicalJson(body)));
        if (checksum !== dataset.manifest.checksumSha256)
            throw new Error('Dataset checksum mismatch');
    }
}
