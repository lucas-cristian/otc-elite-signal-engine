import type { SignalDirection } from '../../common/models/journal-types.js';
import type { StructureRegime, Timeframe, VolatilityRegime } from '../../common/models/types.js';

export const PHASE4_PROTOCOL_VERSION = '2' as const;
export const PHASE4_EXPERIMENT_ID = 'P4-EURUSDOTC-V182-002' as const;
export const PHASE4_RETIRED_EXPERIMENT_ID = 'P4-EURUSDOTC-V182-001' as const;
export const PHASE4_BASELINE_APP_VERSION = '1.8.2' as const;
export const PHASE4_BASELINE_STRATEGY_GIT_COMMIT = '386e83db0a44832c589080b9f7be9215d6a057a4' as const;
export const PHASE4_BASELINE_SCIENTIFIC_CORE_SHA256 = 'ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db' as const;
export const PHASE4_TARGET_SAMPLE_SIZE = 500 as const;
export const PHASE4_ALPHA = 0.01 as const;
export const PHASE4_STRICT_SETTLEMENT_MAX_DELAY_MS = 1_000 as const;
export const PHASE4_STABILITY_BLOCK_SIZE = 100 as const;
export const PHASE4_DATASET_SCHEMA_VERSION = '10' as const;

export type Phase4DerivedStatus = 'NOT_STARTED' | 'COLLECTING' | 'PASS' | 'FAIL' | 'INVALIDATED';
export type Phase4GateStatus = 'PASS' | 'FAIL' | 'PENDING';

export interface Phase4Experiment {
  experimentSchemaVersion: '2';
  experimentId: string;
  protocolVersion: typeof PHASE4_PROTOCOL_VERSION;
  frozen: true;
  baselineAppVersion: typeof PHASE4_BASELINE_APP_VERSION;
  baselineStrategyGitCommit: typeof PHASE4_BASELINE_STRATEGY_GIT_COMMIT;
  scientificCoreSha256: string;
  validationAuthoritySha256: string;
  protocolSha256: string;
  createdByAppVersion: string;
  createdByBuildGitCommit: string;
  createdBySourceTreeSha256: string;
  configHash: string;
  canonicalAssetId: 'EURUSDOTC';
  expirationSeconds: 60;
  prospectiveStartedAt: number;
  targetSampleSize: typeof PHASE4_TARGET_SAMPLE_SIZE;
  alpha: typeof PHASE4_ALPHA;
  strictSettlementMaxDelayMs: typeof PHASE4_STRICT_SETTLEMENT_MAX_DELAY_MS;
  primaryEndpoint: 'STRICT_DIRECTIONAL_ACCURACY';
  nullHypothesis: 'P_LE_0_50';
  alternativeHypothesis: 'P_GT_0_50';
  stabilityPolicyId: 'STABILITY_GATE_V1';
  stabilityBlockSize: typeof PHASE4_STABILITY_BLOCK_SIZE;
  datasetSchemaVersion: typeof PHASE4_DATASET_SCHEMA_VERSION;
}

export interface Phase4BuildIdentity {
  appVersion: string;
  buildId: string;
  sourceTreeSha256: string | null;
  scientificCoreSha256: string | null;
  phase4ValidationAuthoritySha256: string | null;
  phase4ProtocolSha256: string | null;
  gitCommit: string | null;
  gitWorkingTreeClean: boolean | null;
  gitProvenance: 'GIT' | 'ENVIRONMENT' | 'UNAVAILABLE';
}

export type Phase4ExclusionReason =
  | 'PRE_PROSPECTIVE_PERIOD'
  | 'POST_CONFIRMATORY_PERIOD'
  | 'CONFIG_HASH_MISMATCH'
  | 'UNVERIFIED_SOURCE'
  | 'INVALID_EVENT_INTEGRITY'
  | 'NON_LIVE_EXECUTION'
  | 'WRONG_ASSET'
  | 'WRONG_EXPIRATION'
  | 'RESULT_UNRESOLVED'
  | 'ENTRY_UNRESOLVED'
  | 'FLAT_DIRECTIONAL_OUTCOME'
  | 'EXPIRY_TIMING_OUTSIDE_STRICT_WINDOW'
  | 'INVALID_EXPIRY_TIMING'
  | 'REFERENCE_TIMELINE_MISMATCH'
  | 'NON_REFERENCE_FEED_EVALUATION'
  | 'DECISION_SIGNAL_MISMATCH'
  | 'ENTRY_SIGNAL_MISMATCH'
  | 'MARKET_SOURCE_MISMATCH'
  | 'FEED_EPOCH_MISMATCH'
  | 'ARBITRATION_NOT_PRIMARY'
  | 'MISSING_SIGNAL'
  | 'MISSING_DECISION'
  | 'MISSING_ENTRY_RESOLUTION'
  | 'MISSING_MARKET_EPISODE'
  | 'DUPLICATE_MARKET_EPISODE'
  | 'DATASET_SCHEMA_UNSUPPORTED'
  | 'DATASET_PROVENANCE_INVALID'
  | 'DATASET_WORKTREE_DIRTY'
  | 'SCIENTIFIC_CORE_MISMATCH'
  | 'SOURCE_TREE_MISMATCH'
  | 'VALIDATION_AUTHORITY_MISMATCH'
  | 'PHASE4_PROTOCOL_MISMATCH'
  | 'LATE_PRE_CUTOFF_EPISODE'
  | 'VALIDATION_AUTHORITY_NOT_FULLY_FROZEN';

export interface Phase4EpisodeRecord {
  episodeSchemaVersion: '2';
  key: string;
  experimentId: string;
  marketEpisodeId: string;
  signalId: string;
  decisionId: string;
  entryResolutionId: string;
  sourceDatasetId: string;
  sourceGitCommit: string;
  canonicalAssetId: 'EURUSDOTC';
  sourceFeedId: string;
  feedEpochId: string;
  signalCreatedAt: number;
  referenceEntryTimestamp: number;
  expectedExpiryTimestamp: number;
  referenceExitTimestamp: number;
  resultEvaluatedAt: number;
  timeframe: Timeframe;
  direction: SignalDirection;
  structureRegime: StructureRegime;
  volatilityRegime: VolatilityRegime;
  contributingStrategyIds: string[];
  expiryTimingErrorMs: number;
  directionalOutcome: 'CORRECT' | 'INCORRECT';
}

export interface Phase4DatasetImportRecord {
  importSchemaVersion: '2';
  key: string;
  experimentId: string;
  datasetId: string;
  datasetSchemaVersion: string;
  checksumSha256: string;
  gitCommit: string;
  gitProvenance: 'GIT';
  gitWorkingTreeClean: true;
  sourceTreeSha256: string | null;
  scientificCoreSha256: string;
  validationAuthoritySha256: string;
  protocolSha256: string;
  importedAt: number;
  acceptedEpisodeCount: number;
  excludedEpisodeCount: number;
  duplicateEpisodeCount: number;
}

export interface Phase4ExclusionRecord {
  exclusionSchemaVersion: '2';
  exclusionId: string;
  experimentId: string;
  sourceDatasetId: string;
  signalId: string | null;
  marketEpisodeId: string | null;
  occurredAt: number;
  reason: Phase4ExclusionReason;
  detail: string | null;
}

export type Phase4AuditEventType =
  | 'EXPERIMENT_CREATED'
  | 'EXPERIMENT_FROZEN'
  | 'COLLECTION_STARTED'
  | 'LIVE_JOURNAL_SYNCED'
  | 'DATASET_IMPORTED'
  | 'EPISODES_ACCEPTED'
  | 'EPISODES_REJECTED'
  | 'SAMPLE_TARGET_REACHED'
  | 'CONFIRMATORY_TEST_EXECUTED'
  | 'EXPERIMENT_PASSED'
  | 'EXPERIMENT_FAILED'
  | 'EXPERIMENT_INVALIDATED';

export interface Phase4AuditEvent {
  auditEventSchemaVersion: '2';
  auditEventId: string;
  experimentId: string;
  eventType: Phase4AuditEventType;
  occurredAt: number;
  detail: string;
}

export interface Phase4StabilityBlock {
  block: number;
  startOrdinal: number;
  endOrdinal: number;
  resolved: number;
  correct: number;
  accuracy: number | null;
}

export interface Phase4Evaluation {
  evaluationSchemaVersion: '2';
  experimentId: string;
  evaluatedAt: number;
  confirmatorySampleSize: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  exactBinomialPValue: number;
  wilson99Low: number;
  wilson99High: number;
  integrityGate: 'PASS';
  stabilityGate: 'PASS' | 'FAIL';
  statisticalGate: 'PASS' | 'FAIL';
  finalStatus: 'PASS' | 'FAIL';
  sampleCutoffSignalCreatedAt: number;
  sampleCutoffMarketEpisodeId: string;
}

export interface Phase4PerformanceSlice {
  key: string;
  resolved: number;
  correct: number;
  accuracy: number | null;
}

export interface Phase4HistoricalExperimentSummary {
  experimentId: string;
  status: 'INVALIDATED';
  acceptedEpisodes: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  invalidationDetail: string;
}

export interface Phase4Report {
  reportSchemaVersion: '2';
  reportId: string;
  experiment: Phase4Experiment | null;
  status: Phase4DerivedStatus;
  prospectiveUniqueStrictEpisodes: number;
  targetSampleSize: number;
  remaining: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  wilson95Low: number | null;
  wilson95High: number | null;
  wilson99Low: number | null;
  wilson99High: number | null;
  exactBinomialPValue: number | null;
  confirmatoryEligible: boolean;
  confirmatoryEvaluation: Phase4Evaluation | null;
  integrityGate: Phase4GateStatus;
  stabilityGate: Phase4GateStatus;
  stabilityBlocks: Phase4StabilityBlock[];
  importedDatasetCount: number;
  duplicateEpisodeCount: number;
  exclusionsByReason: Partial<Record<Phase4ExclusionReason, number>>;
  timeframePerformance: Phase4PerformanceSlice[];
  directionPerformance: Phase4PerformanceSlice[];
  structureRegimePerformance: Phase4PerformanceSlice[];
  volatilityRegimePerformance: Phase4PerformanceSlice[];
  contributingStrategyPerformance: Phase4PerformanceSlice[];
  historicalInvalidatedExperiments: Phase4HistoricalExperimentSummary[];
  economicValidationStatus: 'UNAVAILABLE';
  economicValidationReason: 'PAYOUT_EXPIRATION_UNBOUND';
}

export interface Phase4EvidenceBundleManifest {
  evidenceBundleSchemaVersion: '1';
  evidenceBundleId: string;
  experimentId: string;
  generatedAt: number;
  scientificCoreSha256: string;
  validationAuthoritySha256: string;
  protocolSha256: string;
  bodyChecksumSha256: string;
}

export interface Phase4EvidenceBundle {
  manifest: Phase4EvidenceBundleManifest;
  report: Phase4Report;
  experiment: Phase4Experiment;
  acceptedEpisodes: Phase4EpisodeRecord[];
  importedDatasets: Phase4DatasetImportRecord[];
  exclusions: Phase4ExclusionRecord[];
  auditEvents: Phase4AuditEvent[];
  evaluations: Phase4Evaluation[];
}
