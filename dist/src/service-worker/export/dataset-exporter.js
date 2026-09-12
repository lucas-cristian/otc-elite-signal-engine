import { canonicalEntityHash, canonicalJson } from '../../common/hashing/canonical-hash.js';
import { sha256 } from '../../common/hashing/sha256.js';
import { PROTOCOL_VERIFICATION_REGISTRY_VERSION } from '../../common/protocol/protocol-verification-registry.js';
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
            continuityEvents: snapshot.continuityEvents,
            transportEvents: snapshot.transportEvents,
        };
        const checksumSha256 = sha256(new TextEncoder().encode(canonicalJson(body)));
        const configHashes = [...new Set(snapshot.decisions.map((decision) => decision.configHash))].sort();
        const protocolVerificationIds = [...new Set([
                ...snapshot.ticks.flatMap((tick) => tick.protocolVerificationId === null ? [] : [tick.protocolVerificationId]),
                ...snapshot.payoutSnapshots.flatMap((payout) => payout.protocolVerificationId === null ? [] : [payout.protocolVerificationId]),
            ])].sort();
        const assetFeedHealthAtExport = metadata.assetFeedHealth.map((item) => ({
            canonicalAssetId: item.canonicalAssetId,
            feedId: item.feedId,
            state: item.state,
            reason: item.reason,
            assessedAt: item.assessedAt,
            latestTickReceivedAt: item.latestTickReceivedAt,
            latestTickAgeMs: item.latestTickAgeMs,
        }));
        const reconnectTypes = new Set(['PAGE_WS_CLOSE', 'PAGE_WS_ERROR', 'SHADOW_WS_CLOSE', 'SHADOW_RECONNECT_SCHEDULED', 'SHADOW_STALL_DETECTED']);
        const manifestBase = {
            datasetSchemaVersion: '5',
            createdAt: metadata.createdAt,
            appVersion: metadata.appVersion,
            buildId: metadata.buildId,
            sourceTreeSha256: metadata.sourceTreeSha256,
            gitCommit: metadata.gitCommit,
            gitWorkingTreeClean: metadata.gitWorkingTreeClean,
            protocolRegistryVersion: PROTOCOL_VERIFICATION_REGISTRY_VERSION,
            protocolVerificationIds,
            exportOperationalDataState: metadata.operationalHealth.state,
            exportOperationalDataReason: metadata.operationalHealth.reason,
            latestTickAgeMsAtExport: metadata.operationalHealth.latestTickAgeMs,
            assetFeedHealthAtExport,
            captureTransportAtExport: metadata.captureTransport,
            tickCount: snapshot.ticks.length,
            decisionCount: snapshot.decisions.length,
            rawCandidateDecisionCount: snapshot.decisions.filter((decision) => decision.arbitrationStatus !== 'NOT_APPLICABLE').length,
            marketEpisodeCount: new Set(snapshot.decisions.filter((decision) => decision.arbitrationStatus === 'PRIMARY' && decision.marketEpisodeId !== null).map((decision) => decision.marketEpisodeId)).size,
            suppressedCorrelatedDecisionCount: snapshot.decisions.filter((decision) => decision.arbitrationStatus === 'SUPPRESSED_CORRELATED' || decision.arbitrationStatus === 'SUPPRESSED_ACTIVE_EPISODE').length,
            signalCount: snapshot.signals.length,
            resultCount: snapshot.results.length,
            continuityEventCount: snapshot.continuityEvents.length,
            transportEventCount: snapshot.transportEvents.length,
            reconnectEventCount: snapshot.transportEvents.filter((event) => reconnectTypes.has(event.eventType)).length,
            configHashes,
            checksumSha256,
        };
        const manifest = { ...manifestBase, datasetId: canonicalEntityHash('DATASET', 5, manifestBase) };
        return { manifest, ...body };
    }
}
