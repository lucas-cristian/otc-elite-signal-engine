import { canonicalEntityHash, canonicalJson } from '../../common/hashing/canonical-hash.js';
import { sha256 } from '../../common/hashing/sha256.js';
export class DatasetExporter {
    journal;
    constructor(journal) {
        this.journal = journal;
    }
    async create(metadata) {
        const snapshot = await this.journal.snapshot();
        const body = {
            ticks: snapshot.ticks,
            payoutSnapshots: snapshot.payoutSnapshots,
            candles: snapshot.candles,
            decisions: snapshot.decisions,
            entryResolutions: snapshot.entryResolutions,
            decisionSignalLinks: snapshot.decisionSignalLinks,
            signals: snapshot.signals,
            results: snapshot.results,
        };
        const checksumSha256 = sha256(new TextEncoder().encode(canonicalJson(body)));
        const configHashes = [...new Set(snapshot.decisions.map((decision) => decision.configHash))].sort();
        const manifestBase = {
            datasetSchemaVersion: '2',
            createdAt: metadata.createdAt,
            appVersion: metadata.appVersion,
            buildId: metadata.buildId,
            sourceTreeSha256: metadata.sourceTreeSha256,
            gitCommit: metadata.gitCommit,
            gitWorkingTreeClean: metadata.gitWorkingTreeClean,
            tickCount: snapshot.ticks.length,
            decisionCount: snapshot.decisions.length,
            signalCount: snapshot.signals.length,
            resultCount: snapshot.results.length,
            configHashes,
            checksumSha256,
        };
        const manifest = {
            ...manifestBase,
            datasetId: canonicalEntityHash('DATASET', 2, manifestBase),
        };
        return { manifest, ...body };
    }
}
