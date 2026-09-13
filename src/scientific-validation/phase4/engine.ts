import { canonicalEntityHash, canonicalJson } from '../../common/hashing/canonical-hash.js';
import { sha256 } from '../../common/hashing/sha256.js';
import type { ScientificDataset } from '../../common/models/dataset-types.js';
import type { DecisionRecord, EntryResolutionRecord, ResultRecord, SignalRecord } from '../../common/models/journal-types.js';
import type { MarketSourceIdentity } from '../../common/models/types.js';
import type { JournalSnapshot } from '../../service-worker/storage/journal-repository.js';
import { exactOneSidedBinomialPValue } from '../statistics/exact-binomial.js';
import { wilsonInterval } from '../statistics/wilson-interval.js';
import type { Phase4Repository, Phase4Snapshot } from './repository.js';
import {
  PHASE4_ALPHA,
  PHASE4_BASELINE_APP_VERSION,
  PHASE4_BASELINE_SCIENTIFIC_CORE_SHA256,
  PHASE4_BASELINE_STRATEGY_GIT_COMMIT,
  PHASE4_DATASET_SCHEMA_VERSION,
  PHASE4_EXPERIMENT_ID,
  PHASE4_PROTOCOL_VERSION,
  PHASE4_RETIRED_EXPERIMENT_ID,
  PHASE4_STABILITY_BLOCK_SIZE,
  PHASE4_STRICT_SETTLEMENT_MAX_DELAY_MS,
  PHASE4_TARGET_SAMPLE_SIZE,
  type Phase4AuditEvent,
  type Phase4AuditEventType,
  type Phase4BuildIdentity,
  type Phase4DatasetImportRecord,
  type Phase4EpisodeRecord,
  type Phase4Evaluation,
  type Phase4EvidenceBundle,
  type Phase4ExclusionReason,
  type Phase4ExclusionRecord,
  type Phase4Experiment,
  type Phase4HistoricalExperimentSummary,
  type Phase4PerformanceSlice,
  type Phase4Report,
  type Phase4StabilityBlock,
} from './types.js';

interface IngestionCounts { accepted: number; excluded: number; duplicates: number; }

interface DatasetManifestV10 {
  datasetSchemaVersion: '10';
  datasetId: string;
  checksumSha256: string;
  sourceTreeSha256: string | null;
  gitCommit: string | null;
  gitWorkingTreeClean: boolean | null;
  gitProvenance: 'GIT' | 'ENVIRONMENT' | 'UNAVAILABLE';
  scientificCoreSha256: string | null;
  phase4ValidationAuthoritySha256: string | null;
  phase4ProtocolSha256: string | null;
  configHashes: string[];
}

type ScientificDatasetV10 = Omit<ScientificDataset, 'manifest'> & { manifest: ScientificDataset['manifest'] & DatasetManifestV10 };

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

function isDatasetV10(value: unknown): value is ScientificDatasetV10 {
  if (!isRecord(value) || !isRecord(value.manifest)) return false;
  return value.manifest.datasetSchemaVersion === '10'
    && typeof value.manifest.datasetId === 'string'
    && typeof value.manifest.checksumSha256 === 'string'
    && Array.isArray(value.manifest.configHashes)
    && Array.isArray(value.ticks) && Array.isArray(value.payoutSnapshots) && Array.isArray(value.candles)
    && Array.isArray(value.decisions) && Array.isArray(value.entryResolutions) && Array.isArray(value.decisionSignalLinks)
    && Array.isArray(value.signals) && Array.isArray(value.results) && Array.isArray(value.continuityEvents) && Array.isArray(value.transportEvents);
}

function sortedEpisodes(episodes: Phase4EpisodeRecord[]): Phase4EpisodeRecord[] {
  return [...episodes].sort((a, b) => a.signalCreatedAt - b.signalCreatedAt || a.marketEpisodeId.localeCompare(b.marketEpisodeId));
}

function performanceSlice(episodes: Phase4EpisodeRecord[], keys: (episode: Phase4EpisodeRecord) => string[]): Phase4PerformanceSlice[] {
  const stats = new Map<string, { resolved: number; correct: number }>();
  for (const episode of episodes) for (const key of new Set(keys(episode))) {
    const current = stats.get(key) ?? { resolved: 0, correct: 0 };
    current.resolved += 1;
    if (episode.directionalOutcome === 'CORRECT') current.correct += 1;
    stats.set(key, current);
  }
  return [...stats.entries()].map(([key, value]) => ({ key, ...value, accuracy: value.resolved === 0 ? null : value.correct / value.resolved }))
    .sort((a, b) => b.resolved - a.resolved || a.key.localeCompare(b.key));
}

function stabilityBlocks(episodes: Phase4EpisodeRecord[]): Phase4StabilityBlock[] {
  const sorted = sortedEpisodes(episodes); const blocks: Phase4StabilityBlock[] = [];
  for (let start = 0; start < sorted.length; start += PHASE4_STABILITY_BLOCK_SIZE) {
    const slice = sorted.slice(start, start + PHASE4_STABILITY_BLOCK_SIZE);
    const correct = slice.filter((episode) => episode.directionalOutcome === 'CORRECT').length;
    blocks.push({ block: Math.floor(start / PHASE4_STABILITY_BLOCK_SIZE) + 1, startOrdinal: start + 1, endOrdinal: start + slice.length, resolved: slice.length, correct, accuracy: slice.length === 0 ? null : correct / slice.length });
  }
  return blocks;
}

function stabilityGatePass(blocks: Phase4StabilityBlock[]): boolean {
  const complete = blocks.filter((block) => block.resolved === PHASE4_STABILITY_BLOCK_SIZE).slice(0, 5);
  if (complete.length < 5) return false;
  return complete.filter((block) => (block.accuracy ?? 0) >= 0.5).length >= 4 && Math.min(...complete.map((block) => block.accuracy ?? 0)) >= 0.45;
}

function bodyOf(dataset: ScientificDatasetV10): Omit<ScientificDatasetV10, 'manifest'> {
  return { ticks: dataset.ticks, payoutSnapshots: dataset.payoutSnapshots, candles: dataset.candles, decisions: dataset.decisions, entryResolutions: dataset.entryResolutions, decisionSignalLinks: dataset.decisionSignalLinks, signals: dataset.signals, results: dataset.results, continuityEvents: dataset.continuityEvents, transportEvents: dataset.transportEvents };
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Phase 4 dataset semantic uniqueness failure: ${label}`);
}

function verifyDatasetIntegrity(dataset: ScientificDatasetV10): void {
  const checksum = sha256(new TextEncoder().encode(canonicalJson(bodyOf(dataset))));
  if (checksum !== dataset.manifest.checksumSha256) throw new Error('Phase 4 dataset checksum mismatch');
  const { datasetId, ...manifestBase } = dataset.manifest;
  if (canonicalEntityHash('DATASET', 10, manifestBase) !== datasetId) throw new Error('Phase 4 datasetId mismatch');

  assertUnique(dataset.decisions.map((item) => item.decisionId), 'decisionId');
  assertUnique(dataset.entryResolutions.map((item) => item.entryResolutionId), 'entryResolutionId');
  assertUnique(dataset.signals.map((item) => item.signalId), 'signalId');
  assertUnique(dataset.results.map((item) => item.resultId), 'resultId');
  assertUnique(dataset.decisionSignalLinks.map((item) => `${item.decisionId}:${item.signalId}`), 'decisionSignalLink');

  const reconnectTypes = new Set(['PAGE_WS_CLOSE', 'PAGE_WS_ERROR', 'SHADOW_WS_CLOSE', 'SHADOW_RECONNECT_SCHEDULED', 'SHADOW_STALL_DETECTED']);
  const configHashes = [...new Set(dataset.decisions.map((decision) => decision.configHash))].sort();
  const expectedCounts = {
    tickCount: dataset.ticks.length,
    decisionCount: dataset.decisions.length,
    rawCandidateDecisionCount: dataset.decisions.filter((decision) => decision.arbitrationStatus !== 'NOT_APPLICABLE').length,
    marketEpisodeCount: new Set(dataset.decisions.filter((decision) => decision.arbitrationStatus === 'PRIMARY' && decision.marketEpisodeId !== null).map((decision) => decision.marketEpisodeId)).size,
    suppressedCorrelatedDecisionCount: dataset.decisions.filter((decision) => decision.arbitrationStatus === 'SUPPRESSED_CORRELATED' || decision.arbitrationStatus === 'SUPPRESSED_ACTIVE_EPISODE').length,
    signalCount: dataset.signals.length,
    resultCount: dataset.results.length,
    continuityEventCount: dataset.continuityEvents.length,
    transportEventCount: dataset.transportEvents.length,
    reconnectEventCount: dataset.transportEvents.filter((event) => reconnectTypes.has(event.eventType)).length,
  };
  for (const [key, value] of Object.entries(expectedCounts)) if ((dataset.manifest as unknown as Record<string, unknown>)[key] !== value) throw new Error(`Phase 4 dataset manifest/body mismatch: ${key}`);
  if (canonicalJson(configHashes) !== canonicalJson(dataset.manifest.configHashes)) throw new Error('Phase 4 dataset manifest/body mismatch: configHashes');
}

function sameMarketSource(a: MarketSourceIdentity, b: MarketSourceIdentity): boolean {
  return a.platform === b.platform && a.canonicalAssetId === b.canonicalAssetId && a.marketType === b.marketType && a.source === b.source && a.feedId === b.feedId && a.instrumentId === b.instrumentId && a.parserSchemaId === b.parserSchemaId;
}

function expectedPriceOutcome(entry: number, exit: number): 'UP' | 'DOWN' | 'FLAT' { return exit > entry ? 'UP' : exit < entry ? 'DOWN' : 'FLAT'; }
function expectedDirectionalOutcome(direction: 'CALL' | 'PUT', price: 'UP' | 'DOWN' | 'FLAT'): 'CORRECT' | 'INCORRECT' | 'FLAT' {
  if (price === 'FLAT') return 'FLAT';
  return (direction === 'CALL' && price === 'UP') || (direction === 'PUT' && price === 'DOWN') ? 'CORRECT' : 'INCORRECT';
}

export class Phase4ValidationEngine {
  public constructor(private readonly repository: Phase4Repository) {}

  public async startExperiment(snapshot: JournalSnapshot, build: Phase4BuildIdentity, nowMs: number): Promise<Phase4Experiment> {
    await this.retireLegacyExperimentIfPresent(nowMs);
    const stored = await this.repository.snapshot();
    const existing = stored.experiments.find((experiment) => experiment.experimentId === PHASE4_EXPERIMENT_ID);
    if (existing) return existing;
    if (build.gitCommit === null || build.gitProvenance !== 'GIT' || build.gitWorkingTreeClean !== true) throw new Error('Phase 4 requires a clean GIT-provenance build');
    if (build.sourceTreeSha256 === null || build.scientificCoreSha256 === null || build.phase4ValidationAuthoritySha256 === null || build.phase4ProtocolSha256 === null) throw new Error('Phase 4 build identity is incomplete');
    if (build.scientificCoreSha256 !== PHASE4_BASELINE_SCIENTIFIC_CORE_SHA256) throw new Error('Phase 4 scientific core does not match the frozen v1.8.2 baseline');
    const latestDecision = snapshot.decisions.filter((decision) => decision.canonicalAssetId === 'EURUSDOTC').sort((a, b) => b.decisionComputedAt - a.decisionComputedAt)[0];
    if (!latestDecision) throw new Error('Phase 4 cannot start before at least one EURUSDOTC decision exists');
    const experiment: Phase4Experiment = {
      experimentSchemaVersion: '2', experimentId: PHASE4_EXPERIMENT_ID, protocolVersion: PHASE4_PROTOCOL_VERSION, frozen: true,
      baselineAppVersion: PHASE4_BASELINE_APP_VERSION, baselineStrategyGitCommit: PHASE4_BASELINE_STRATEGY_GIT_COMMIT,
      scientificCoreSha256: build.scientificCoreSha256, validationAuthoritySha256: build.phase4ValidationAuthoritySha256, protocolSha256: build.phase4ProtocolSha256,
      createdByAppVersion: build.appVersion, createdByBuildGitCommit: build.gitCommit, createdBySourceTreeSha256: build.sourceTreeSha256,
      configHash: latestDecision.configHash, canonicalAssetId: 'EURUSDOTC', expirationSeconds: 60, prospectiveStartedAt: nowMs,
      targetSampleSize: PHASE4_TARGET_SAMPLE_SIZE, alpha: PHASE4_ALPHA, strictSettlementMaxDelayMs: PHASE4_STRICT_SETTLEMENT_MAX_DELAY_MS,
      primaryEndpoint: 'STRICT_DIRECTIONAL_ACCURACY', nullHypothesis: 'P_LE_0_50', alternativeHypothesis: 'P_GT_0_50',
      stabilityPolicyId: 'STABILITY_GATE_V1', stabilityBlockSize: PHASE4_STABILITY_BLOCK_SIZE, datasetSchemaVersion: PHASE4_DATASET_SCHEMA_VERSION,
    };
    await this.repository.appendExperiment(experiment);
    await this.appendAudit(experiment.experimentId, 'EXPERIMENT_CREATED', nowMs, 'Prospective Phase 4 v2 experiment created');
    await this.appendAudit(experiment.experimentId, 'EXPERIMENT_FROZEN', nowMs, 'Protocol, scientific core, validation authority, config hash and confirmatory rules frozen');
    await this.appendAudit(experiment.experimentId, 'COLLECTION_STARTED', nowMs, 'Prospective collection boundary established');
    return experiment;
  }

  public async syncLiveJournal(snapshot: JournalSnapshot, build: Phase4BuildIdentity, nowMs: number): Promise<Phase4Report> {
    await this.retireLegacyExperimentIfPresent(nowMs);
    const stored = await this.repository.snapshot();
    const experiment = stored.experiments.find((item) => item.experimentId === PHASE4_EXPERIMENT_ID) ?? null;
    if (!experiment) return this.reportFromSnapshot(stored, null);
    if (build.sourceTreeSha256 !== experiment.createdBySourceTreeSha256) return this.invalidateAndReport(experiment, nowMs, 'SOURCE_TREE_MISMATCH', `Expected ${experiment.createdBySourceTreeSha256}, got ${build.sourceTreeSha256 ?? 'null'}`);
    if (build.scientificCoreSha256 !== experiment.scientificCoreSha256) return this.invalidateAndReport(experiment, nowMs, 'SCIENTIFIC_CORE_MISMATCH', `Expected ${experiment.scientificCoreSha256}, got ${build.scientificCoreSha256 ?? 'null'}`);
    if (build.phase4ValidationAuthoritySha256 !== experiment.validationAuthoritySha256) return this.invalidateAndReport(experiment, nowMs, 'VALIDATION_AUTHORITY_MISMATCH', `Expected ${experiment.validationAuthoritySha256}, got ${build.phase4ValidationAuthoritySha256 ?? 'null'}`);
    if (build.phase4ProtocolSha256 !== experiment.protocolSha256) return this.invalidateAndReport(experiment, nowMs, 'PHASE4_PROTOCOL_MISMATCH', `Expected ${experiment.protocolSha256}, got ${build.phase4ProtocolSha256 ?? 'null'}`);
    if (build.gitCommit === null || build.gitProvenance !== 'GIT' || build.gitWorkingTreeClean !== true) return this.invalidateAndReport(experiment, nowMs, 'DATASET_PROVENANCE_INVALID', 'Live build requires clean GIT provenance');
    const counts = await this.ingestRecords(experiment, snapshot.decisions, snapshot.entryResolutions, snapshot.signals, snapshot.results, 'LIVE_JOURNAL', build.gitCommit, false);
    if (counts.accepted > 0 || counts.excluded > 0) await this.appendAudit(experiment.experimentId, 'LIVE_JOURNAL_SYNCED', nowMs, `accepted=${counts.accepted}; excluded=${counts.excluded}`);
    await this.evaluateIfReady(experiment);
    return this.report();
  }

  public async importDatasetJson(json: string, nowMs: number): Promise<Phase4Report> {
    const parsed: unknown = JSON.parse(json);
    if (!isDatasetV10(parsed)) throw new Error('Phase 4 requires scientific dataset schema v10');
    verifyDatasetIntegrity(parsed);
    const stored = await this.repository.snapshot();
    const experiment = stored.experiments.find((item) => item.experimentId === PHASE4_EXPERIMENT_ID);
    if (!experiment) throw new Error('Start and freeze Phase 4 before importing datasets');
    if (parsed.manifest.gitCommit === null || parsed.manifest.gitProvenance !== 'GIT') throw new Error('Dataset GIT provenance invalid');
    if (parsed.manifest.gitWorkingTreeClean !== true) throw new Error('Dataset working tree was not clean at build time');
    if (parsed.manifest.sourceTreeSha256 !== experiment.createdBySourceTreeSha256) throw new Error('Dataset source tree does not match frozen Phase 4 source tree');
    if (parsed.manifest.scientificCoreSha256 !== experiment.scientificCoreSha256) throw new Error('Dataset scientific core does not match frozen Phase 4 core');
    if (parsed.manifest.phase4ValidationAuthoritySha256 !== experiment.validationAuthoritySha256) throw new Error('Dataset Phase 4 validation authority does not match frozen authority');
    if (parsed.manifest.phase4ProtocolSha256 !== experiment.protocolSha256) throw new Error('Dataset Phase 4 protocol does not match frozen protocol');
    if (!parsed.manifest.configHashes.includes(experiment.configHash)) throw new Error('Dataset does not contain the frozen Phase 4 config hash');
    const datasetKey = `${experiment.experimentId}:${parsed.manifest.datasetId}`;
    if (stored.datasets.some((dataset) => dataset.key === datasetKey)) return this.reportFromSnapshot(stored, experiment);
    const counts = await this.ingestRecords(experiment, parsed.decisions, parsed.entryResolutions, parsed.signals, parsed.results, parsed.manifest.datasetId, parsed.manifest.gitCommit, true);
    const record: Phase4DatasetImportRecord = {
      importSchemaVersion: '2', key: datasetKey, experimentId: experiment.experimentId, datasetId: parsed.manifest.datasetId, datasetSchemaVersion: parsed.manifest.datasetSchemaVersion,
      checksumSha256: parsed.manifest.checksumSha256, gitCommit: parsed.manifest.gitCommit, gitProvenance: 'GIT', gitWorkingTreeClean: true,
      sourceTreeSha256: parsed.manifest.sourceTreeSha256, scientificCoreSha256: parsed.manifest.scientificCoreSha256 ?? '',
      validationAuthoritySha256: parsed.manifest.phase4ValidationAuthoritySha256 ?? '', protocolSha256: parsed.manifest.phase4ProtocolSha256 ?? '',
      importedAt: nowMs, acceptedEpisodeCount: counts.accepted, excludedEpisodeCount: counts.excluded, duplicateEpisodeCount: counts.duplicates,
    };
    await this.repository.appendDataset(record);
    await this.appendAudit(experiment.experimentId, 'DATASET_IMPORTED', nowMs, `${record.datasetId}; accepted=${counts.accepted}; excluded=${counts.excluded}; duplicates=${counts.duplicates}`);
    await this.evaluateIfReady(experiment);
    return this.report();
  }

  public async report(): Promise<Phase4Report> {
    const snapshot = await this.repository.snapshot();
    const experiment = snapshot.experiments.find((item) => item.experimentId === PHASE4_EXPERIMENT_ID) ?? null;
    return this.reportFromSnapshot(snapshot, experiment);
  }

  public async evidenceBundle(generatedAt: number): Promise<Phase4EvidenceBundle> {
    const snapshot = await this.repository.snapshot();
    const experiment = snapshot.experiments.find((item) => item.experimentId === PHASE4_EXPERIMENT_ID);
    if (!experiment) throw new Error('Phase 4 has not started');
    const report = this.reportFromSnapshot(snapshot, experiment);
    const body = {
      report,
      experiment,
      acceptedEpisodes: sortedEpisodes(snapshot.episodes.filter((item) => item.experimentId === experiment.experimentId)),
      importedDatasets: snapshot.datasets.filter((item) => item.experimentId === experiment.experimentId).sort((a, b) => a.datasetId.localeCompare(b.datasetId)),
      exclusions: snapshot.exclusions.filter((item) => item.experimentId === experiment.experimentId).sort((a, b) => a.occurredAt - b.occurredAt || a.exclusionId.localeCompare(b.exclusionId)),
      auditEvents: snapshot.auditEvents.filter((item) => item.experimentId === experiment.experimentId).sort((a, b) => a.occurredAt - b.occurredAt || a.auditEventId.localeCompare(b.auditEventId)),
      evaluations: snapshot.evaluations.filter((item) => item.experimentId === experiment.experimentId),
    };
    const bodyChecksumSha256 = sha256(new TextEncoder().encode(canonicalJson(body)));
    const manifestBase = { evidenceBundleSchemaVersion: '1' as const, experimentId: experiment.experimentId, generatedAt, scientificCoreSha256: experiment.scientificCoreSha256, validationAuthoritySha256: experiment.validationAuthoritySha256, protocolSha256: experiment.protocolSha256, bodyChecksumSha256 };
    return { manifest: { ...manifestBase, evidenceBundleId: canonicalEntityHash('PHASE4_EVIDENCE_BUNDLE', 1, manifestBase) }, ...body };
  }

  private async ingestRecords(experiment: Phase4Experiment, decisions: DecisionRecord[], entries: EntryResolutionRecord[], signals: SignalRecord[], results: ResultRecord[], sourceDatasetId: string, sourceGitCommit: string, recordDuplicates: boolean): Promise<IngestionCounts> {
    const decisionById = new Map(decisions.map((decision) => [decision.decisionId, decision]));
    const signalById = new Map(signals.map((signal) => [signal.signalId, signal]));
    const entryByDecisionId = new Map(entries.map((entry) => [entry.decisionId, entry]));
    const existingSnapshot = await this.repository.snapshot();
    const existingKeys = new Set(existingSnapshot.episodes.map((episode) => episode.key));
    const existingExclusionIds = new Set(existingSnapshot.exclusions.map((item) => item.exclusionId));
    const evaluation = existingSnapshot.evaluations.find((item) => item.experimentId === experiment.experimentId) ?? null;
    let accepted = 0; let excluded = 0; let duplicates = 0;

    for (const result of results) {
      const signal = signalById.get(result.signalId) ?? null;
      const decision = signal ? decisionById.get(signal.decisionId) ?? null : null;
      const entry = decision ? entryByDecisionId.get(decision.decisionId) ?? null : null;
      const eligibility = this.eligibility(experiment, decision, entry, signal, result);
      if (eligibility !== null) {
        if (await this.appendExclusionIfNew(existingExclusionIds, experiment.experimentId, sourceDatasetId, signal, result, eligibility.reason, eligibility.detail)) excluded += 1;
        continue;
      }
      if (!signal || !decision || !entry || entry.resolutionStatus !== 'RESOLVED' || result.resolutionStatus !== 'RESOLVED' || result.directionalOutcome === 'FLAT') continue;
      const key = `${experiment.experimentId}:${signal.marketEpisodeId}`;
      if (existingKeys.has(key)) {
        if (recordDuplicates && await this.appendExclusionIfNew(existingExclusionIds, experiment.experimentId, sourceDatasetId, signal, result, 'DUPLICATE_MARKET_EPISODE', key)) duplicates += 1;
        continue;
      }
      if (evaluation) {
        const beforeOrAtCutoff = signal.signalCreatedAt < evaluation.sampleCutoffSignalCreatedAt || (signal.signalCreatedAt === evaluation.sampleCutoffSignalCreatedAt && signal.marketEpisodeId <= evaluation.sampleCutoffMarketEpisodeId);
        if (beforeOrAtCutoff) {
          if (await this.appendExclusionIfNew(existingExclusionIds, experiment.experimentId, sourceDatasetId, signal, result, 'LATE_PRE_CUTOFF_EPISODE', key)) excluded += 1;
          await this.invalidateOnce(experiment.experimentId, result.evaluatedAt, 'LATE_PRE_CUTOFF_EPISODE', key);
        } else if (await this.appendExclusionIfNew(existingExclusionIds, experiment.experimentId, sourceDatasetId, signal, result, 'POST_CONFIRMATORY_PERIOD', key)) excluded += 1;
        continue;
      }
      const episode: Phase4EpisodeRecord = {
        episodeSchemaVersion: '2', key, experimentId: experiment.experimentId, marketEpisodeId: signal.marketEpisodeId, signalId: signal.signalId, decisionId: decision.decisionId,
        entryResolutionId: entry.entryResolutionId, sourceDatasetId, sourceGitCommit, canonicalAssetId: 'EURUSDOTC', sourceFeedId: signal.entryMarketSourceIdentity.feedId,
        feedEpochId: signal.feedEpochId, signalCreatedAt: signal.signalCreatedAt, referenceEntryTimestamp: signal.referenceEntryTimestamp, expectedExpiryTimestamp: signal.expectedExpiryTimestamp,
        referenceExitTimestamp: result.referenceExitTimestamp, resultEvaluatedAt: result.evaluatedAt, timeframe: decision.timeframe, direction: signal.direction,
        structureRegime: decision.structureRegime, volatilityRegime: decision.volatilityRegime,
        contributingStrategyIds: [...new Set(decision.strategySnapshots.filter((strategy) => strategy.direction === signal.direction).map((strategy) => strategy.strategyId))].sort(),
        expiryTimingErrorMs: result.expiryTimingErrorMs, directionalOutcome: result.directionalOutcome,
      };
      await this.repository.appendEpisode(episode); existingKeys.add(key); accepted += 1;
    }
    const auditTime = results.reduce((latest, item) => Math.max(latest, item.evaluatedAt), experiment.prospectiveStartedAt);
    if (accepted > 0) await this.appendAudit(experiment.experimentId, 'EPISODES_ACCEPTED', auditTime, `${sourceDatasetId}: ${accepted}`);
    if (excluded > 0) await this.appendAudit(experiment.experimentId, 'EPISODES_REJECTED', auditTime, `${sourceDatasetId}: ${excluded}`);
    return { accepted, excluded, duplicates };
  }

  private eligibility(experiment: Phase4Experiment, decision: DecisionRecord | null, entry: EntryResolutionRecord | null, signal: SignalRecord | null, result: ResultRecord): { reason: Phase4ExclusionReason; detail: string | null } | null {
    if (!signal) return { reason: 'MISSING_SIGNAL', detail: result.signalId };
    if (!decision) return { reason: 'MISSING_DECISION', detail: signal.decisionId };
    if (!entry) return { reason: 'MISSING_ENTRY_RESOLUTION', detail: signal.decisionId };
    if (signal.signalCreatedAt < experiment.prospectiveStartedAt) return { reason: 'PRE_PROSPECTIVE_PERIOD', detail: null };
    if (!signal.marketEpisodeId) return { reason: 'MISSING_MARKET_EPISODE', detail: null };
    if (decision.configHash !== experiment.configHash) return { reason: 'CONFIG_HASH_MISMATCH', detail: decision.configHash };
    if (decision.canonicalAssetId !== experiment.canonicalAssetId || signal.canonicalAssetId !== experiment.canonicalAssetId) return { reason: 'WRONG_ASSET', detail: signal.canonicalAssetId };
    if (signal.expirationSeconds !== experiment.expirationSeconds || decision.expirationSeconds !== experiment.expirationSeconds) return { reason: 'WRONG_EXPIRATION', detail: String(signal.expirationSeconds) };
    if (decision.executionMode !== 'LIVE' || signal.executionMode !== 'LIVE') return { reason: 'NON_LIVE_EXECUTION', detail: null };
    if (decision.sourceQuality !== 'VERIFIED') return { reason: 'UNVERIFIED_SOURCE', detail: decision.sourceQuality };
    if (decision.eventIntegrity !== 'VALID') return { reason: 'INVALID_EVENT_INTEGRITY', detail: decision.eventIntegrity };
    if (decision.arbitrationStatus !== 'PRIMARY') return { reason: 'ARBITRATION_NOT_PRIMARY', detail: decision.arbitrationStatus };
    if (decision.decisionId !== signal.decisionId || decision.finalDecision !== signal.direction || decision.marketEpisodeId !== signal.marketEpisodeId) return { reason: 'DECISION_SIGNAL_MISMATCH', detail: null };
    if (decision.feedEpochId !== signal.feedEpochId) return { reason: 'FEED_EPOCH_MISMATCH', detail: `${decision.feedEpochId}:${signal.feedEpochId}` };
    if (entry.resolutionStatus !== 'RESOLVED') return { reason: 'ENTRY_UNRESOLVED', detail: entry.unresolvedReason };
    if (entry.decisionId !== decision.decisionId || entry.referenceEntryTimestamp !== signal.referenceEntryTimestamp || entry.referenceEntryPrice !== signal.referenceEntryPrice || entry.entryPageSessionId !== signal.entryPageSessionId || entry.entryReferencePolicy !== 'FIRST_TICK_AFTER_ALERT') return { reason: 'ENTRY_SIGNAL_MISMATCH', detail: null };
    if (entry.entryDelayMs < 0 || entry.referenceEntryTimestamp - entry.decisionPublishedAt !== entry.entryDelayMs || entry.decisionPublishedAt !== decision.decisionPublishedAt || signal.signalCreatedAt !== signal.referenceEntryTimestamp) return { reason: 'REFERENCE_TIMELINE_MISMATCH', detail: 'entry timeline' };
    if (signal.expectedExpiryTimestamp !== signal.referenceEntryTimestamp + signal.expirationSeconds * 1_000) return { reason: 'REFERENCE_TIMELINE_MISMATCH', detail: 'expected expiry' };
    if (decision.sourceFeedId === null || decision.sourceFeedId !== signal.entryMarketSourceIdentity.feedId || !sameMarketSource(entry.entryMarketSourceIdentity, signal.entryMarketSourceIdentity)) return { reason: 'MARKET_SOURCE_MISMATCH', detail: 'entry source' };
    if (result.evaluationMode !== 'REFERENCE_FEED') return { reason: 'NON_REFERENCE_FEED_EVALUATION', detail: result.evaluationMode };
    if (result.resolutionStatus !== 'RESOLVED') return { reason: 'RESULT_UNRESOLVED', detail: result.unresolvedReason };
    if (result.entryPageSessionId !== signal.entryPageSessionId || !sameMarketSource(signal.entryMarketSourceIdentity, result.exitMarketSourceIdentity)) return { reason: 'MARKET_SOURCE_MISMATCH', detail: 'exit source' };
    if (!Number.isInteger(result.expiryTimingErrorMs) || result.expiryTimingErrorMs < 0) return { reason: 'INVALID_EXPIRY_TIMING', detail: String(result.expiryTimingErrorMs) };
    if (result.referenceExitTimestamp - signal.expectedExpiryTimestamp !== result.expiryTimingErrorMs || result.evaluatedAt < result.referenceExitTimestamp) return { reason: 'REFERENCE_TIMELINE_MISMATCH', detail: 'settlement timeline' };
    if (result.expiryTimingErrorMs > experiment.strictSettlementMaxDelayMs) return { reason: 'EXPIRY_TIMING_OUTSIDE_STRICT_WINDOW', detail: String(result.expiryTimingErrorMs) };
    const priceOutcome = expectedPriceOutcome(signal.referenceEntryPrice, result.referenceExitPrice);
    const directionalOutcome = expectedDirectionalOutcome(signal.direction, priceOutcome);
    if (result.priceOutcome !== priceOutcome || result.directionalOutcome !== directionalOutcome) return { reason: 'REFERENCE_TIMELINE_MISMATCH', detail: 'outcome semantics' };
    if (result.directionalOutcome === 'FLAT') return { reason: 'FLAT_DIRECTIONAL_OUTCOME', detail: null };
    return null;
  }

  private async appendExclusionIfNew(existingIds: Set<string>, experimentId: string, sourceDatasetId: string, signal: SignalRecord | null, result: ResultRecord, reason: Phase4ExclusionReason, detail: string | null): Promise<boolean> {
    const occurredAt = result.evaluatedAt;
    const input = { experimentId, sourceDatasetId, signalId: signal?.signalId ?? null, marketEpisodeId: signal?.marketEpisodeId ?? null, occurredAt, reason, detail };
    const exclusion: Phase4ExclusionRecord = { exclusionSchemaVersion: '2', exclusionId: canonicalEntityHash('PHASE4_EXCLUSION', 2, input), ...input };
    if (existingIds.has(exclusion.exclusionId)) return false;
    await this.repository.appendExclusion(exclusion); existingIds.add(exclusion.exclusionId); return true;
  }

  private async appendAudit(experimentId: string, eventType: Phase4AuditEventType, occurredAt: number, detail: string): Promise<void> {
    const input = { experimentId, eventType, occurredAt, detail };
    await this.repository.appendAuditEvent({ auditEventSchemaVersion: '2', auditEventId: canonicalEntityHash('PHASE4_AUDIT', 2, input), ...input });
  }

  private async retireLegacyExperimentIfPresent(nowMs: number): Promise<void> {
    const snapshot = await this.repository.snapshot();
    if (!snapshot.experiments.some((item) => item.experimentId === PHASE4_RETIRED_EXPERIMENT_ID)) return;
    if (snapshot.auditEvents.some((event) => event.experimentId === PHASE4_RETIRED_EXPERIMENT_ID && event.eventType === 'EXPERIMENT_INVALIDATED')) return;
    await this.appendAudit(PHASE4_RETIRED_EXPERIMENT_ID, 'EXPERIMENT_INVALIDATED', nowMs, 'VALIDATION_AUTHORITY_NOT_FULLY_FROZEN: retained historical experiment; observed outcomes must not be reused as confirmatory evidence');
  }

  private async invalidateOnce(experimentId: string, occurredAt: number, reason: Phase4ExclusionReason, detail: string): Promise<void> {
    const snapshot = await this.repository.snapshot();
    if (snapshot.auditEvents.some((event) => event.experimentId === experimentId && event.eventType === 'EXPERIMENT_INVALIDATED')) return;
    await this.appendAudit(experimentId, 'EXPERIMENT_INVALIDATED', occurredAt, `${reason}: ${detail}`);
  }

  private async invalidateAndReport(experiment: Phase4Experiment, occurredAt: number, reason: Phase4ExclusionReason, detail: string): Promise<Phase4Report> {
    await this.invalidateOnce(experiment.experimentId, occurredAt, reason, detail); return this.report();
  }

  private async evaluateIfReady(experiment: Phase4Experiment): Promise<void> {
    const snapshot = await this.repository.snapshot();
    if (snapshot.evaluations.some((evaluation) => evaluation.experimentId === experiment.experimentId)) return;
    if (snapshot.auditEvents.some((event) => event.experimentId === experiment.experimentId && event.eventType === 'EXPERIMENT_INVALIDATED')) return;
    const episodes = sortedEpisodes(snapshot.episodes.filter((episode) => episode.experimentId === experiment.experimentId));
    if (episodes.length < experiment.targetSampleSize) return;
    const confirmatory = episodes.slice(0, experiment.targetSampleSize); const correct = confirmatory.filter((episode) => episode.directionalOutcome === 'CORRECT').length;
    const pValue = exactOneSidedBinomialPValue(correct, confirmatory.length, 0.5); const interval99 = wilsonInterval(correct, confirmatory.length, 0.99);
    if (pValue === null || interval99 === null) throw new Error('Unable to evaluate Phase 4 confirmatory sample');
    const blocks = stabilityBlocks(confirmatory); const stabilityPass = stabilityGatePass(blocks); const statisticalPass = pValue < experiment.alpha && interval99.low > 0.5;
    const cutoff = confirmatory[confirmatory.length - 1]; if (!cutoff) throw new Error('Phase 4 confirmatory cutoff unavailable');
    const evaluatedAt = Math.max(...confirmatory.map((episode) => episode.resultEvaluatedAt));
    const evaluation: Phase4Evaluation = { evaluationSchemaVersion: '2', experimentId: experiment.experimentId, evaluatedAt, confirmatorySampleSize: confirmatory.length, correct, incorrect: confirmatory.length - correct, accuracy: correct / confirmatory.length, exactBinomialPValue: pValue, wilson99Low: interval99.low, wilson99High: interval99.high, integrityGate: 'PASS', stabilityGate: stabilityPass ? 'PASS' : 'FAIL', statisticalGate: statisticalPass ? 'PASS' : 'FAIL', finalStatus: stabilityPass && statisticalPass ? 'PASS' : 'FAIL', sampleCutoffSignalCreatedAt: cutoff.signalCreatedAt, sampleCutoffMarketEpisodeId: cutoff.marketEpisodeId };
    await this.repository.appendEvaluation(evaluation);
    await this.appendAudit(experiment.experimentId, 'SAMPLE_TARGET_REACHED', evaluatedAt, `n=${confirmatory.length}`);
    await this.appendAudit(experiment.experimentId, 'CONFIRMATORY_TEST_EXECUTED', evaluatedAt, `p=${pValue}; wilson99Low=${interval99.low}; stability=${evaluation.stabilityGate}`);
    await this.appendAudit(experiment.experimentId, evaluation.finalStatus === 'PASS' ? 'EXPERIMENT_PASSED' : 'EXPERIMENT_FAILED', evaluatedAt, evaluation.finalStatus);
  }

  private historicalSummaries(snapshot: Phase4Snapshot): Phase4HistoricalExperimentSummary[] {
    const retired = snapshot.experiments.filter((item) => item.experimentId === PHASE4_RETIRED_EXPERIMENT_ID);
    return retired.map((experiment) => {
      const episodes = snapshot.episodes.filter((item) => item.experimentId === experiment.experimentId);
      const correct = episodes.filter((item) => item.directionalOutcome === 'CORRECT').length;
      const invalidation = snapshot.auditEvents.filter((item) => item.experimentId === experiment.experimentId && item.eventType === 'EXPERIMENT_INVALIDATED').sort((a, b) => b.occurredAt - a.occurredAt)[0];
      return { experimentId: experiment.experimentId, status: 'INVALIDATED', acceptedEpisodes: episodes.length, correct, incorrect: episodes.length - correct, accuracy: episodes.length === 0 ? null : correct / episodes.length, invalidationDetail: invalidation?.detail ?? 'VALIDATION_AUTHORITY_NOT_FULLY_FROZEN' };
    });
  }

  private reportFromSnapshot(snapshot: Phase4Snapshot, experiment: Phase4Experiment | null): Phase4Report {
    const historicalInvalidatedExperiments = this.historicalSummaries(snapshot);
    const make = (base: Omit<Phase4Report, 'reportId'>): Phase4Report => ({ ...base, reportId: canonicalEntityHash('PHASE4_REPORT', 2, base) });
    if (!experiment) return make({ reportSchemaVersion: '2', experiment: null, status: 'NOT_STARTED', prospectiveUniqueStrictEpisodes: 0, targetSampleSize: PHASE4_TARGET_SAMPLE_SIZE, remaining: PHASE4_TARGET_SAMPLE_SIZE, correct: 0, incorrect: 0, accuracy: null, wilson95Low: null, wilson95High: null, wilson99Low: null, wilson99High: null, exactBinomialPValue: null, confirmatoryEligible: false, confirmatoryEvaluation: null, integrityGate: 'PENDING', stabilityGate: 'PENDING', stabilityBlocks: [], importedDatasetCount: 0, duplicateEpisodeCount: 0, exclusionsByReason: {}, timeframePerformance: [], directionPerformance: [], structureRegimePerformance: [], volatilityRegimePerformance: [], contributingStrategyPerformance: [], historicalInvalidatedExperiments, economicValidationStatus: 'UNAVAILABLE', economicValidationReason: 'PAYOUT_EXPIRATION_UNBOUND' });
    const episodes = sortedEpisodes(snapshot.episodes.filter((episode) => episode.experimentId === experiment.experimentId)); const correct = episodes.filter((episode) => episode.directionalOutcome === 'CORRECT').length;
    const interval95 = wilsonInterval(correct, episodes.length, 0.95); const interval99 = wilsonInterval(correct, episodes.length, 0.99); const pValue = exactOneSidedBinomialPValue(correct, episodes.length, 0.5);
    const evaluation = snapshot.evaluations.find((item) => item.experimentId === experiment.experimentId) ?? null; const invalidated = snapshot.auditEvents.some((event) => event.experimentId === experiment.experimentId && event.eventType === 'EXPERIMENT_INVALIDATED');
    const exclusionsByReason: Partial<Record<Phase4ExclusionReason, number>> = {}; for (const exclusion of snapshot.exclusions.filter((item) => item.experimentId === experiment.experimentId)) exclusionsByReason[exclusion.reason] = (exclusionsByReason[exclusion.reason] ?? 0) + 1;
    return make({ reportSchemaVersion: '2', experiment, status: invalidated ? 'INVALIDATED' : evaluation?.finalStatus ?? 'COLLECTING', prospectiveUniqueStrictEpisodes: episodes.length, targetSampleSize: experiment.targetSampleSize, remaining: Math.max(0, experiment.targetSampleSize - episodes.length), correct, incorrect: episodes.length - correct, accuracy: episodes.length === 0 ? null : correct / episodes.length, wilson95Low: interval95?.low ?? null, wilson95High: interval95?.high ?? null, wilson99Low: interval99?.low ?? null, wilson99High: interval99?.high ?? null, exactBinomialPValue: pValue, confirmatoryEligible: episodes.length >= experiment.targetSampleSize && !invalidated, confirmatoryEvaluation: evaluation, integrityGate: invalidated ? 'FAIL' : 'PASS', stabilityGate: evaluation?.stabilityGate ?? 'PENDING', stabilityBlocks: stabilityBlocks(episodes.slice(0, experiment.targetSampleSize)), importedDatasetCount: snapshot.datasets.filter((dataset) => dataset.experimentId === experiment.experimentId).length, duplicateEpisodeCount: exclusionsByReason.DUPLICATE_MARKET_EPISODE ?? 0, exclusionsByReason, timeframePerformance: performanceSlice(episodes, (episode) => [episode.timeframe]), directionPerformance: performanceSlice(episodes, (episode) => [episode.direction]), structureRegimePerformance: performanceSlice(episodes, (episode) => [episode.structureRegime]), volatilityRegimePerformance: performanceSlice(episodes, (episode) => [episode.volatilityRegime]), contributingStrategyPerformance: performanceSlice(episodes, (episode) => episode.contributingStrategyIds), historicalInvalidatedExperiments, economicValidationStatus: 'UNAVAILABLE', economicValidationReason: 'PAYOUT_EXPIRATION_UNBOUND' });
  }
}
