import { canonicalEntityHash, canonicalJson } from '../../common/hashing/canonical-hash.js';
import { sha256 } from '../../common/hashing/sha256.js';
import type { DatasetManifest, ScientificDataset } from '../../common/models/dataset-types.js';
import type { JournalRepository } from '../storage/journal-repository.js';

export interface ExportMetadata {
  appVersion: string;
  buildId: string;
  gitCommit: string | null;
  createdAt: number;
}

export class DatasetExporter {
  public constructor(private readonly journal: JournalRepository) {}

  public async create(metadata: ExportMetadata): Promise<ScientificDataset> {
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
      datasetSchemaVersion: '1' as const,
      createdAt: metadata.createdAt,
      appVersion: metadata.appVersion,
      buildId: metadata.buildId,
      gitCommit: metadata.gitCommit,
      tickCount: snapshot.ticks.length,
      decisionCount: snapshot.decisions.length,
      signalCount: snapshot.signals.length,
      resultCount: snapshot.results.length,
      configHashes,
      checksumSha256,
    };
    const manifest: DatasetManifest = {
      ...manifestBase,
      datasetId: canonicalEntityHash('DATASET', 1, manifestBase),
    };
    return { manifest, ...body };
  }
}
