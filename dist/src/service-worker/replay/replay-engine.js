import { canonicalJson } from '../../common/hashing/canonical-hash.js';
import { sha256 } from '../../common/hashing/sha256.js';
import { QuantPipeline } from '../core/quant-pipeline.js';
import { MemoryJournal } from '../storage/memory-journal.js';
import { DatasetExporter } from '../export/dataset-exporter.js';
export class ReplayEngine {
    async replay(dataset, config) {
        this.verifyChecksum(dataset);
        const journal = new MemoryJournal();
        const pipeline = new QuantPipeline(journal, { ...config, executionMode: 'REPLAY' });
        const firstTimestamp = dataset.ticks[0]?.receivedAtEpochMs ?? dataset.manifest.createdAt;
        await pipeline.initialize(firstTimestamp);
        const payouts = [...dataset.payoutSnapshots].sort((a, b) => a.capturedAt - b.capturedAt);
        const latestByAsset = new Map();
        let payoutIndex = 0;
        const ticks = [...dataset.ticks].sort((a, b) => a.receivedAtEpochMs - b.receivedAtEpochMs || a.sequence - b.sequence);
        for (const tick of ticks) {
            while (payoutIndex < payouts.length && (payouts[payoutIndex]?.capturedAt ?? Infinity) <= tick.receivedAtEpochMs) {
                const payout = payouts[payoutIndex];
                if (payout)
                    latestByAsset.set(payout.canonicalAssetId, payout);
                payoutIndex += 1;
            }
            await pipeline.enqueue({ tick, payoutSnapshot: latestByAsset.get(tick.marketSourceIdentity.canonicalAssetId) ?? null });
        }
        await pipeline.drain();
        return new DatasetExporter(journal).create({
            appVersion: dataset.manifest.appVersion,
            buildId: `${dataset.manifest.buildId}:replay`,
            gitCommit: dataset.manifest.gitCommit,
            createdAt: dataset.manifest.createdAt,
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
        };
        const checksum = sha256(new TextEncoder().encode(canonicalJson(body)));
        if (checksum !== dataset.manifest.checksumSha256)
            throw new Error('Dataset checksum mismatch');
    }
}
