import { canonicalEntityHash, canonicalJson } from '../../common/hashing/canonical-hash.js';
import { sha256 } from '../../common/hashing/sha256.js';
import type { ScientificDataset } from '../../common/models/dataset-types.js';
import type { DecisionRecord, ResultRecord, SignalRecord } from '../../common/models/journal-types.js';
import type { JournalSnapshot } from '../../service-worker/storage/journal-repository.js';
import { exactOneSidedBinomialPValue } from '../statistics/exact-binomial.js';
import { wilsonInterval } from '../statistics/wilson-interval.js';
import type { Phase4Repository, Phase4Snapshot } from './repository.js';
import {
  PHASE4_ALPHA,
  PHASE4_BASELINE_APP_VERSION,
  PHASE4_BASELINE_SCIENTIFIC_CORE_SHA256,
  PHASE4_BASELINE_STRATEGY_GIT_COMMIT,
  PHASE4_EXPERIMENT_ID,
  PHASE4_PROTOCOL_VERSION,
  PHASE4_STABILITY_BLOCK_SIZE,
  PHASE4_STRICT_SETTLEMENT_MAX_DELAY_MS,
  PHASE4_TARGET_SAMPLE_SIZE,
  type Phase4AuditEvent,
  type Phase4AuditEventType,
  type Phase4BuildIdentity,
  type Phase4DatasetImportRecord,
  type Phase4EpisodeRecord,
  type Phase4Evaluation,
  type Phase4ExclusionReason,
  type Phase4ExclusionRecord,
  type Phase4Experiment,
  type Phase4PerformanceSlice,
  type Phase4Report,
  type Phase4StabilityBlock,
} from './types.js';

interface IngestionCounts {
  accepted: number;
  excluded: number;
  duplicates: number;
}

interface DatasetManifestV9 {
  datasetSchemaVersion: '9';
  datasetId: string;
  checksumSha256: string;
  gitCommit: string | null;
  gitProvenance: 'GIT' | 'ENVIRONMENT' | 'UNAVAILABLE';
  scientificCoreSha256: string | null;
  configHashes: string[];
}

interface ScientificDatasetV9 extends Omit<ScientificDataset, 'manifest'> {
  manifest: ScientificDataset['manifest'] & DatasetManifestV9;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDatasetV9(value: unknown): value is ScientificDatasetV9 {
  if (!isRecord(value) || !isRecord(value.manifest)) return false;
  return value.manifest.datasetSchemaVersion === '9'
    && typeof value.manifest.datasetId === 'string'
    && typeof value.manifest.checksumSha256 === 'string'
    && Array.isArray(value.manifest.configHashes)
    && Array.isArray(value.ticks)
    && Array.isArray(value.payoutSnapshots)
    && Array.isArray(value.candles)
    && Array.isArray(value.decisions)
    && Array.isArray(value.entryResolutions)
    && Array.isArray(value.decisionSignalLinks)
    && Array.isArray(value.signals)
    && Array.isArray(value.results)
    && Array.isArray(value.continuityEvents)
    && Array.isArray(value.transportEvents);
}

function sortedEpisodes(episodes: Phase4EpisodeRecord[]): Phase4EpisodeRecord[] {
  return [...episodes].sort((a, b) => a.signalCreatedAt - b.signalCreatedAt || a.marketEpisodeId.localeCompare(b.marketEpisodeId));
}

function performanceSlice(episodes: Phase4EpisodeRecord[], keys: (episode: Phase4EpisodeRecord) => string[]): Phase4PerformanceSlice[] {
  const stats = new Map<string, { resolved: number; correct: number }>();
  for (const episode of episodes) {
    for (const key of new Set(keys(episode))) {
      const current = stats.get(key) ?? { resolved: 0, correct: 0 };
      current.resolved += 1;
      if (episode.directionalOutcome === 'CORRECT') current.correct += 1;
      stats.set(key, current);
    }
  }
  return [...stats.entries()]
    .map(([key, value]) => ({ key, ...value, accuracy: value.resolved === 0 ? null : value.correct / value.resolved }))
    .sort((a, b) => b.resolved - a.resolved || a.key.localeCompare(b.key));
}

function stabilityBlocks(episodes: Phase4EpisodeRecord[]): Phase4StabilityBlock[] {
  const sorted = sortedEpisodes(episodes);
  const blocks: Phase4StabilityBlock[] = [];
  for (let start = 0; start < sorted.length; start += PHASE4_STABILITY_BLOCK_SIZE) {
    const slice = sorted.slice(start, start + PHASE4_STABILITY_BLOCK_SIZE);
    const correct = slice.filter((episode) => episode.directionalOutcome === 'CORRECT').length;
    blocks.push({
      block: Math.floor(start / PHASE4_STABILITY_BLOCK_SIZE) + 1,
      startOrdinal: start + 1,
      endOrdinal: start + slice.length,
      resolved: slice.length,
      correct,
      accuracy: slice.length === 0 ? null : correct / slice.length,
    });
  }
  return blocks;
}

function stabilityGatePass(blocks: Phase4StabilityBlock[]): boolean {
  const complete = blocks.filter((block) => block.resolved === PHASE4_STABILITY_BLOCK_SIZE).slice(0, 5);
  if (complete.length < 5) return false;
  const atOrAboveHalf = complete.filter((block) => (block.accuracy ?? 0) >= 0.5).length;
  const minimum = Math.min(...complete.map((block) => block.accuracy ?? 0));
  return atOrAboveHalf >= 4 && minimum >= 0.45;
}

function bodyOf(dataset: ScientificDatasetV9): Omit<ScientificDatasetV9, 'manifest'> {
  return {
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
}

function verifyDatasetIntegrity(dataset: ScientificDatasetV9): void {
  const checksum = sha256(new TextEncoder().encode(canonicalJson(bodyOf(dataset))));
  if (checksum !== dataset.manifest.checksumSha256) throw new Error('Phase 4 dataset checksum mismatch');
  const { datasetId, ...manifestBase } = dataset.manifest;
  const expectedDatasetId = canonicalEntityHash('DATASET', 9, manifestBase);
  if (expectedDatasetId !== datasetId) throw new Error('Phase 4 datasetId mismatch');
}

export class Phase4ValidationEngine {
  public constructor(private readonly repository: Phase4Repository) {}

  public async startExperiment(snapshot: JournalSnapshot, build: Phase4BuildIdentity, nowMs: number): Promise<Phase4Experiment> {
    const stored = await this.repository.snapshot();
    const existing = stored.experiments.find((experiment) => experiment.experimentId === PHASE4_EXPERIMENT_ID);
    if (existing) return existing;
    if (build.gitCommit === null || build.gitProvenance === 'UNAVAILABLE' || build.gitWorkingTreeClean !== true) {
      throw new Error('Phase 4 requires a clean Git-provenance build');
    }
    if (build.sourceTreeSha256 === null || build.scientificCoreSha256 === null) throw new Error('Phase 4 build identity is incomplete');
    if (build.scientificCoreSha256 !== PHASE4_BASELINE_SCIENTIFIC_CORE_SHA256) {
      throw new Error('Phase 4 scientific core does not match the frozen v1.8.2 baseline');
    }
    const latestDecision = snapshot.decisions
      .filter((decision) => decision.canonicalAssetId === 'EURUSDOTC')
      .sort((a, b) => b.decisionComputedAt - a.decisionComputedAt)[0];
    if (!latestDecision) throw new Error('Phase 4 cannot start before at least one EURUSDOTC decision exists');
    const experiment: Phase4Experiment = {
      experimentSchemaVersion: '1',
      experimentId: PHASE4_EXPERIMENT_ID,
      protocolVersion: PHASE4_PROTOCOL_VERSION,
      frozen: true,
      baselineAppVersion: PHASE4_BASELINE_APP_VERSION,
      baselineStrategyGitCommit: PHASE4_BASELINE_STRATEGY_GIT_COMMIT,
      scientificCoreSha256: build.scientificCoreSha256,
      createdByBuildGitCommit: build.gitCommit,
      createdBySourceTreeSha256: build.sourceTreeSha256,
      configHash: latestDecision.configHash,
      canonicalAssetId: 'EURUSDOTC',
      expirationSeconds: 60,
      prospectiveStartedAt: nowMs,
      targetSampleSize: PHASE4_TARGET_SAMPLE_SIZE,
      alpha: PHASE4_ALPHA,
      strictSettlementMaxDelayMs: PHASE4_STRICT_SETTLEMENT_MAX_DELAY_MS,
      primaryEndpoint: 'STRICT_DIRECTIONAL_ACCURACY',
      nullHypothesis: 'P_LE_0_50',
      alternativeHypothesis: 'P_GT_0_50',
      stabilityPolicyId: 'STABILITY_GATE_V1',
      stabilityBlockSize: PHASE4_STABILITY_BLOCK_SIZE,
    };
    await this.repository.appendExperiment(experiment);
    await this.appendAudit(experiment.experimentId, 'EXPERIMENT_CREATED', nowMs, 'Prospective Phase 4 experiment created');
    await this.appendAudit(experiment.experimentId, 'EXPERIMENT_FROZEN', nowMs, 'Protocol, scientific core, config hash and confirmatory rules frozen');
    await this.appendAudit(experiment.experimentId, 'COLLECTION_STARTED', nowMs, 'Prospective collection boundary established');
    return experiment;
  }

  public async syncLiveJournal(snapshot: JournalSnapshot, build: Phase4BuildIdentity, nowMs: number): Promise<Phase4Report> {
    const stored = await this.repository.snapshot();
    const experiment = stored.experiments.find((item) => item.experimentId === PHASE4_EXPERIMENT_ID) ?? null;
    if (!experiment) return this.reportFromSnapshot(stored, null);
    if (build.scientificCoreSha256 !== experiment.scientificCoreSha256) {
      await this.invalidateOnce(experiment.experimentId, nowMs, 'SCIENTIFIC_CORE_MISMATCH', `Expected ${experiment.scientificCoreSha256}, got ${build.scientificCoreSha256 ?? 'null'}`);
      return this.report();
    }
    if (build.gitCommit === null || build.gitProvenance === 'UNAVAILABLE') {
      await this.invalidateOnce(experiment.experimentId, nowMs, 'DATASET_PROVENANCE_INVALID', 'Live build Git provenance unavailable');
      return this.report();
    }
    const counts = await this.ingestRecords(experiment, snapshot.decisions, snapshot.signals, snapshot.results, 'LIVE_JOURNAL', build.gitCommit, false);
    if (counts.accepted > 0 || counts.excluded > 0) {
      await this.appendAudit(experiment.experimentId, 'LIVE_JOURNAL_SYNCED', nowMs, `accepted=${counts.accepted}; excluded=${counts.excluded}`);
    }
    await this.evaluateIfReady(experiment);
    return this.report();
  }

  public async importDatasetJson(json: string, nowMs: number): Promise<Phase4Report> {
    const parsed: unknown = JSON.parse(json);
    if (!isDatasetV9(parsed)) throw new Error('Phase 4 requires scientific dataset schema v9');
    verifyDatasetIntegrity(parsed);
    const stored = await this.repository.snapshot();
    const experiment = stored.experiments.find((item) => item.experimentId === PHASE4_EXPERIMENT_ID);
    if (!experiment) throw new Error('Start and freeze Phase 4 before importing datasets');
    if (parsed.manifest.gitCommit === null || parsed.manifest.gitProvenance === 'UNAVAILABLE') throw new Error('Dataset Git provenance invalid');
    if (parsed.manifest.scientificCoreSha256 !== experiment.scientificCoreSha256) throw new Error('Dataset scientific core does not match frozen Phase 4 core');
    if (!parsed.manifest.configHashes.includes(experiment.configHash)) throw new Error('Dataset does not contain the frozen Phase 4 config hash');
    const datasetKey = `${experiment.experimentId}:${parsed.manifest.datasetId}`;
    if (stored.datasets.some((dataset) => dataset.key === datasetKey)) return this.reportFromSnapshot(stored, experiment);

    const counts = await this.ingestRecords(experiment, parsed.decisions, parsed.signals, parsed.results, parsed.manifest.datasetId, parsed.manifest.gitCommit, true);
    const record: Phase4DatasetImportRecord = {
      importSchemaVersion: '1',
      key: datasetKey,
      experimentId: experiment.experimentId,
      datasetId: parsed.manifest.datasetId,
      datasetSchemaVersion: parsed.manifest.datasetSchemaVersion,
      checksumSha256: parsed.manifest.checksumSha256,
      gitCommit: parsed.manifest.gitCommit,
      scientificCoreSha256: parsed.manifest.scientificCoreSha256 ?? '',
      importedAt: nowMs,
      acceptedEpisodeCount: counts.accepted,
      excludedEpisodeCount: counts.excluded,
      duplicateEpisodeCount: counts.duplicates,
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

  private async ingestRecords(
    experiment: Phase4Experiment,
    decisions: DecisionRecord[],
    signals: SignalRecord[],
    results: ResultRecord[],
    sourceDatasetId: string,
    sourceGitCommit: string,
    recordDuplicates: boolean,
  ): Promise<IngestionCounts> {
    const decisionById = new Map(decisions.map((decision) => [decision.decisionId, decision]));
    const signalById = new Map(signals.map((signal) => [signal.signalId, signal]));
    const existingSnapshot = await this.repository.snapshot();
    const existingKeys = new Set(existingSnapshot.episodes.map((episode) => episode.key));
    const evaluation = existingSnapshot.evaluations.find((item) => item.experimentId === experiment.experimentId) ?? null;
    let accepted = 0;
    let excluded = 0;
    let duplicates = 0;

    for (const result of results) {
      const signal = signalById.get(result.signalId) ?? null;
      const decision = signal ? decisionById.get(signal.decisionId) ?? null : null;
      const eligibility = this.eligibility(experiment, decision, signal, result);
      if (eligibility !== null) {
        await this.appendExclusion(experiment.experimentId, sourceDatasetId, signal, result, eligibility.reason, eligibility.detail);
        excluded += 1;
        continue;
      }
      if (!signal || !decision || result.resolutionStatus !== 'RESOLVED' || result.directionalOutcome === 'FLAT') continue;
      const key = `${experiment.experimentId}:${signal.marketEpisodeId}`;
      if (existingKeys.has(key)) {
        if (recordDuplicates) {
          await this.appendExclusion(experiment.experimentId, sourceDatasetId, signal, result, 'DUPLICATE_MARKET_EPISODE', key);
          duplicates += 1;
        }
        continue;
      }
      if (evaluation && (signal.signalCreatedAt < evaluation.sampleCutoffSignalCreatedAt
        || (signal.signalCreatedAt === evaluation.sampleCutoffSignalCreatedAt && signal.marketEpisodeId <= evaluation.sampleCutoffMarketEpisodeId))) {
        await this.appendExclusion(experiment.experimentId, sourceDatasetId, signal, result, 'LATE_PRE_CUTOFF_EPISODE', key);
        await this.invalidateOnce(experiment.experimentId, result.evaluatedAt, 'LATE_PRE_CUTOFF_EPISODE', key);
        excluded += 1;
        continue;
      }
      const episode: Phase4EpisodeRecord = {
        episodeSchemaVersion: '1',
        key,
        experimentId: experiment.experimentId,
        marketEpisodeId: signal.marketEpisodeId,
        signalId: signal.signalId,
        decisionId: decision.decisionId,
        sourceDatasetId,
        sourceGitCommit,
        canonicalAssetId: 'EURUSDOTC',
        feedEpochId: signal.feedEpochId,
        signalCreatedAt: signal.signalCreatedAt,
        resultEvaluatedAt: result.evaluatedAt,
        timeframe: decision.timeframe,
        direction: signal.direction,
        structureRegime: decision.structureRegime,
        volatilityRegime: decision.volatilityRegime,
        contributingStrategyIds: [...new Set(decision.strategySnapshots.filter((strategy) => strategy.direction === signal.direction).map((strategy) => strategy.strategyId))].sort(),
        expiryTimingErrorMs: result.expiryTimingErrorMs,
        directionalOutcome: result.directionalOutcome,
      };
      await this.repository.appendEpisode(episode);
      existingKeys.add(key);
      accepted += 1;
    }
    const auditTime = results.reduce((latest, item) => Math.max(latest, item.evaluatedAt), experiment.prospectiveStartedAt);
    if (accepted > 0) await this.appendAudit(experiment.experimentId, 'EPISODES_ACCEPTED', auditTime, `${sourceDatasetId}: ${accepted}`);
    if (excluded > 0) await this.appendAudit(experiment.experimentId, 'EPISODES_REJECTED', auditTime, `${sourceDatasetId}: ${excluded}`);
    return { accepted, excluded, duplicates };
  }

  private eligibility(
    experiment: Phase4Experiment,
    decision: DecisionRecord | null,
    signal: SignalRecord | null,
    result: ResultRecord,
  ): { reason: Phase4ExclusionReason; detail: string | null } | null {
    if (!signal) return { reason: 'MISSING_SIGNAL', detail: result.signalId };
    if (!decision) return { reason: 'MISSING_DECISION', detail: signal.decisionId };
    if (signal.signalCreatedAt < experiment.prospectiveStartedAt) return { reason: 'PRE_PROSPECTIVE_PERIOD', detail: null };
    if (!signal.marketEpisodeId) return { reason: 'MISSING_MARKET_EPISODE', detail: null };
    if (decision.configHash !== experiment.configHash) return { reason: 'CONFIG_HASH_MISMATCH', detail: decision.configHash };
    if (decision.canonicalAssetId !== experiment.canonicalAssetId || signal.canonicalAssetId !== experiment.canonicalAssetId) return { reason: 'WRONG_ASSET', detail: signal.canonicalAssetId };
    if (signal.expirationSeconds !== experiment.expirationSeconds || decision.expirationSeconds !== experiment.expirationSeconds) return { reason: 'WRONG_EXPIRATION', detail: String(signal.expirationSeconds) };
    if (decision.executionMode !== 'LIVE' || signal.executionMode !== 'LIVE') return { reason: 'NON_LIVE_EXECUTION', detail: null };
    if (decision.sourceQuality !== 'VERIFIED') return { reason: 'UNVERIFIED_SOURCE', detail: decision.sourceQuality };
    if (decision.eventIntegrity !== 'VALID') return { reason: 'INVALID_EVENT_INTEGRITY', detail: decision.eventIntegrity };
    if (result.resolutionStatus !== 'RESOLVED') return { reason: 'RESULT_UNRESOLVED', detail: result.unresolvedReason };
    if (result.directionalOutcome === 'FLAT') return { reason: 'FLAT_DIRECTIONAL_OUTCOME', detail: null };
    if (result.expiryTimingErrorMs > experiment.strictSettlementMaxDelayMs) return { reason: 'EXPIRY_TIMING_OUTSIDE_STRICT_WINDOW', detail: String(result.expiryTimingErrorMs) };
    return null;
  }

  private async appendExclusion(
    experimentId: string,
    sourceDatasetId: string,
    signal: SignalRecord | null,
    result: ResultRecord,
    reason: Phase4ExclusionReason,
    detail: string | null,
  ): Promise<void> {
    const occurredAt = result.evaluatedAt;
    const input = { experimentId, sourceDatasetId, signalId: signal?.signalId ?? null, marketEpisodeId: signal?.marketEpisodeId ?? null, occurredAt, reason, detail };
    const exclusion: Phase4ExclusionRecord = {
      exclusionSchemaVersion: '1',
      exclusionId: canonicalEntityHash('PHASE4_EXCLUSION', 1, input),
      ...input,
    };
    await this.repository.appendExclusion(exclusion);
  }

  private async appendAudit(experimentId: string, eventType: Phase4AuditEventType, occurredAt: number, detail: string): Promise<void> {
    const input = { experimentId, eventType, occurredAt, detail };
    const event: Phase4AuditEvent = {
      auditEventSchemaVersion: '1',
      auditEventId: canonicalEntityHash('PHASE4_AUDIT', 1, input),
      ...input,
    };
    await this.repository.appendAuditEvent(event);
  }

  private async invalidateOnce(experimentId: string, occurredAt: number, reason: Phase4ExclusionReason, detail: string): Promise<void> {
    const snapshot = await this.repository.snapshot();
    if (snapshot.auditEvents.some((event) => event.experimentId === experimentId && event.eventType === 'EXPERIMENT_INVALIDATED')) return;
    await this.appendAudit(experimentId, 'EXPERIMENT_INVALIDATED', occurredAt, `${reason}: ${detail}`);
  }

  private async evaluateIfReady(experiment: Phase4Experiment): Promise<void> {
    const snapshot = await this.repository.snapshot();
    if (snapshot.evaluations.some((evaluation) => evaluation.experimentId === experiment.experimentId)) return;
    if (snapshot.auditEvents.some((event) => event.experimentId === experiment.experimentId && event.eventType === 'EXPERIMENT_INVALIDATED')) return;
    const episodes = sortedEpisodes(snapshot.episodes.filter((episode) => episode.experimentId === experiment.experimentId));
    if (episodes.length < experiment.targetSampleSize) return;
    const confirmatory = episodes.slice(0, experiment.targetSampleSize);
    const correct = confirmatory.filter((episode) => episode.directionalOutcome === 'CORRECT').length;
    const incorrect = confirmatory.length - correct;
    const pValue = exactOneSidedBinomialPValue(correct, confirmatory.length, 0.5);
    const interval99 = wilsonInterval(correct, confirmatory.length, 0.99);
    if (pValue === null || interval99 === null) throw new Error('Unable to evaluate Phase 4 confirmatory sample');
    const blocks = stabilityBlocks(confirmatory);
    const stabilityPass = stabilityGatePass(blocks);
    const statisticalPass = pValue < experiment.alpha && interval99.low > 0.5;
    const cutoff = confirmatory[confirmatory.length - 1];
    if (!cutoff) throw new Error('Phase 4 confirmatory cutoff unavailable');
    const evaluatedAt = Math.max(...confirmatory.map((episode) => episode.resultEvaluatedAt));
    const evaluation: Phase4Evaluation = {
      evaluationSchemaVersion: '1',
      experimentId: experiment.experimentId,
      evaluatedAt,
      confirmatorySampleSize: confirmatory.length,
      correct,
      incorrect,
      accuracy: correct / confirmatory.length,
      exactBinomialPValue: pValue,
      wilson99Low: interval99.low,
      wilson99High: interval99.high,
      integrityGate: 'PASS',
      stabilityGate: stabilityPass ? 'PASS' : 'FAIL',
      statisticalGate: statisticalPass ? 'PASS' : 'FAIL',
      finalStatus: stabilityPass && statisticalPass ? 'PASS' : 'FAIL',
      sampleCutoffSignalCreatedAt: cutoff.signalCreatedAt,
      sampleCutoffMarketEpisodeId: cutoff.marketEpisodeId,
    };
    await this.repository.appendEvaluation(evaluation);
    await this.appendAudit(experiment.experimentId, 'SAMPLE_TARGET_REACHED', evaluatedAt, `n=${confirmatory.length}`);
    await this.appendAudit(experiment.experimentId, 'CONFIRMATORY_TEST_EXECUTED', evaluatedAt, `p=${pValue}; wilson99Low=${interval99.low}; stability=${evaluation.stabilityGate}`);
    await this.appendAudit(experiment.experimentId, evaluation.finalStatus === 'PASS' ? 'EXPERIMENT_PASSED' : 'EXPERIMENT_FAILED', evaluatedAt, evaluation.finalStatus);
  }

  private reportFromSnapshot(snapshot: Phase4Snapshot, experiment: Phase4Experiment | null): Phase4Report {
    if (!experiment) {
      return {
        experiment: null,
        status: 'NOT_STARTED',
        prospectiveUniqueStrictEpisodes: 0,
        targetSampleSize: PHASE4_TARGET_SAMPLE_SIZE,
        remaining: PHASE4_TARGET_SAMPLE_SIZE,
        correct: 0,
        incorrect: 0,
        accuracy: null,
        wilson95Low: null,
        wilson95High: null,
        wilson99Low: null,
        wilson99High: null,
        exactBinomialPValue: null,
        confirmatoryEligible: false,
        confirmatoryEvaluation: null,
        integrityGate: 'PENDING',
        stabilityGate: 'PENDING',
        stabilityBlocks: [],
        importedDatasetCount: 0,
        duplicateEpisodeCount: 0,
        exclusionsByReason: {},
        timeframePerformance: [],
        directionPerformance: [],
        structureRegimePerformance: [],
        volatilityRegimePerformance: [],
        contributingStrategyPerformance: [],
        economicValidationStatus: 'UNAVAILABLE',
        economicValidationReason: 'PAYOUT_EXPIRATION_UNBOUND',
      };
    }
    const episodes = sortedEpisodes(snapshot.episodes.filter((episode) => episode.experimentId === experiment.experimentId));
    const correct = episodes.filter((episode) => episode.directionalOutcome === 'CORRECT').length;
    const interval95 = wilsonInterval(correct, episodes.length, 0.95);
    const interval99 = wilsonInterval(correct, episodes.length, 0.99);
    const pValue = exactOneSidedBinomialPValue(correct, episodes.length, 0.5);
    const evaluation = snapshot.evaluations.find((item) => item.experimentId === experiment.experimentId) ?? null;
    const invalidated = snapshot.auditEvents.some((event) => event.experimentId === experiment.experimentId && event.eventType === 'EXPERIMENT_INVALIDATED');
    const exclusionsByReason: Partial<Record<Phase4ExclusionReason, number>> = {};
    for (const exclusion of snapshot.exclusions.filter((item) => item.experimentId === experiment.experimentId)) {
      exclusionsByReason[exclusion.reason] = (exclusionsByReason[exclusion.reason] ?? 0) + 1;
    }
    const blocks = stabilityBlocks(episodes.slice(0, experiment.targetSampleSize));
    const status = invalidated ? 'INVALIDATED' : evaluation?.finalStatus ?? 'COLLECTING';
    return {
      experiment,
      status,
      prospectiveUniqueStrictEpisodes: episodes.length,
      targetSampleSize: experiment.targetSampleSize,
      remaining: Math.max(0, experiment.targetSampleSize - episodes.length),
      correct,
      incorrect: episodes.length - correct,
      accuracy: episodes.length === 0 ? null : correct / episodes.length,
      wilson95Low: interval95?.low ?? null,
      wilson95High: interval95?.high ?? null,
      wilson99Low: interval99?.low ?? null,
      wilson99High: interval99?.high ?? null,
      exactBinomialPValue: pValue,
      confirmatoryEligible: episodes.length >= experiment.targetSampleSize && !invalidated,
      confirmatoryEvaluation: evaluation,
      integrityGate: invalidated ? 'FAIL' : 'PASS',
      stabilityGate: evaluation?.stabilityGate ?? 'PENDING',
      stabilityBlocks: blocks,
      importedDatasetCount: snapshot.datasets.filter((dataset) => dataset.experimentId === experiment.experimentId).length,
      duplicateEpisodeCount: exclusionsByReason.DUPLICATE_MARKET_EPISODE ?? 0,
      exclusionsByReason,
      timeframePerformance: performanceSlice(episodes, (episode) => [episode.timeframe]),
      directionPerformance: performanceSlice(episodes, (episode) => [episode.direction]),
      structureRegimePerformance: performanceSlice(episodes, (episode) => [episode.structureRegime]),
      volatilityRegimePerformance: performanceSlice(episodes, (episode) => [episode.volatilityRegime]),
      contributingStrategyPerformance: performanceSlice(episodes, (episode) => episode.contributingStrategyIds),
      economicValidationStatus: 'UNAVAILABLE',
      economicValidationReason: 'PAYOUT_EXPIRATION_UNBOUND',
    };
  }
}
