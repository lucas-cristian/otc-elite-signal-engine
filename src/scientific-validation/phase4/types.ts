import type { SignalDirection } from '../../common/models/journal-types.js';
import type { StructureRegime, Timeframe, VolatilityRegime } from '../../common/models/types.js';

export const PHASE4_PROTOCOL_VERSION = '4' as const;
export const PHASE4_EXPERIMENT_ID = 'P4-EURUSDOTC-V182-004' as const;
export const PHASE4_RETIRED_EXPERIMENT_IDS = ['P4-EURUSDOTC-V182-001', 'P4-EURUSDOTC-V182-002', 'P4-EURUSDOTC-V182-003'] as const;
export const PHASE4_BUILTIN_HISTORICAL_INVALIDATIONS = [
  { experimentId: 'P4-EURUSDOTC-V182-001', acceptedEpisodes: 10, correct: 3, incorrect: 7, accuracy: 0.3, invalidationDetail: 'VALIDATION_AUTHORITY_NOT_FULLY_FROZEN' },
  { experimentId: 'P4-EURUSDOTC-V182-002', acceptedEpisodes: 10, correct: 4, incorrect: 6, accuracy: 0.4, invalidationDetail: 'FIXED_N_BATCH_BOUNDARY_DEFECT' },
  { experimentId: 'P4-EURUSDOTC-V182-003', acceptedEpisodes: 10, correct: 7, incorrect: 3, accuracy: 0.7, invalidationDetail: 'EXIT_RAW_TICK_QUALITY_NOT_ENFORCED' },
] as const;
export const PHASE4_BASELINE_APP_VERSION = '1.8.2' as const;
export const PHASE4_BASELINE_STRATEGY_GIT_COMMIT = '386e83db0a44832c589080b9f7be9215d6a057a4' as const;
export const PHASE4_BASELINE_SCIENTIFIC_CORE_SHA256 = 'ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db' as const;
export const PHASE4_TARGET_SAMPLE_SIZE = 500 as const;
export const PHASE4_ALPHA = 0.01 as const;
export const PHASE4_STRICT_SETTLEMENT_MAX_DELAY_MS = 1_000 as const;
export const PHASE4_STABILITY_BLOCK_SIZE = 100 as const;
export const PHASE4_MIN_DISTINCT_UTC_DATES = 10 as const;
export const PHASE4_MAX_EPISODES_PER_UTC_DATE = 50 as const;
export const PHASE4_DATASET_SCHEMA_VERSION = '10' as const;

export type Phase4DerivedStatus = 'NOT_STARTED' | 'COLLECTING' | 'PASS' | 'FAIL' | 'INVALIDATED';
export type Phase4GateStatus = 'PASS' | 'FAIL' | 'PENDING';

export interface Phase4Experiment {
  experimentSchemaVersion: '3';
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
  temporalDiversityPolicyId: 'UTC_DATE_DIVERSITY_V1';
  minDistinctUtcDates: typeof PHASE4_MIN_DISTINCT_UTC_DATES;
  maxEpisodesPerUtcDate: typeof PHASE4_MAX_EPISODES_PER_UTC_DATE;
  dependenceSensitivityPolicyId: 'LEAVE_ONE_UTC_DATE_OUT_V1';
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
  | 'TEMPORAL_DAILY_CAP_REACHED'
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
  | 'VALIDATION_AUTHORITY_NOT_FULLY_FROZEN'
  | 'FIXED_N_BATCH_BOUNDARY_DEFECT'
  | 'EXIT_RAW_TICK_QUALITY_NOT_ENFORCED'
  | 'RAW_TICK_ANCHOR_MISMATCH'
  | 'RAW_TICK_QUALITY_INVALID';

export interface Phase4EpisodeRecord {
  episodeSchemaVersion: '3';
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
  utcDate: string;
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
  importSchemaVersion: '3';
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
  exclusionSchemaVersion: '3';
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
  | 'START_ATTESTATION_CREATED'
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
  auditEventSchemaVersion: '3';
  auditEventId: string;
  experimentId: string;
  eventType: Phase4AuditEventType;
  occurredAt: number;
  detail: string;
}

export interface Phase4StartAttestation {
  startAttestationSchemaVersion: '1';
  attestationId: string;
  experimentId: string;
  createdAt: number;
  prospectiveStartedAt: number;
  createdByAppVersion: string;
  createdByBuildGitCommit: string;
  createdBySourceTreeSha256: string;
  scientificCoreSha256: string;
  validationAuthoritySha256: string;
  protocolSha256: string;
  configHash: string;
  targetSampleSize: typeof PHASE4_TARGET_SAMPLE_SIZE;
  alpha: typeof PHASE4_ALPHA;
  strictSettlementMaxDelayMs: typeof PHASE4_STRICT_SETTLEMENT_MAX_DELAY_MS;
  temporalDiversityPolicyId: 'UTC_DATE_DIVERSITY_V1';
  minDistinctUtcDates: typeof PHASE4_MIN_DISTINCT_UTC_DATES;
  maxEpisodesPerUtcDate: typeof PHASE4_MAX_EPISODES_PER_UTC_DATE;
  dependenceSensitivityPolicyId: 'LEAVE_ONE_UTC_DATE_OUT_V1';
  externalPreservationRequired: true;
}

export interface Phase4StabilityBlock {
  block: number;
  startOrdinal: number;
  endOrdinal: number;
  resolved: number;
  correct: number;
  accuracy: number | null;
}

export interface Phase4UtcDatePerformance {
  utcDate: string;
  resolved: number;
  correct: number;
  accuracy: number;
}

export interface Phase4LeaveOneUtcDateOutPerformance {
  excludedUtcDate: string;
  resolved: number;
  correct: number;
  accuracy: number | null;
  wilson95Low: number | null;
  wilson95High: number | null;
}

export interface Phase4Evaluation {
  evaluationSchemaVersion: '3';
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
  temporalDiversityGate: 'PASS' | 'FAIL';
  dependenceSensitivityGate: 'PASS' | 'FAIL';
  statisticalGate: 'PASS' | 'FAIL';
  distinctUtcDateCount: number;
  maxEpisodesOnSingleUtcDate: number;
  minimumLeaveOneUtcDateOutAccuracy: number | null;
  minimumLeaveOneUtcDateOutWilson95Low: number | null;
  worstExcludedUtcDate: string | null;
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
  reportSchemaVersion: '3';
  reportId: string;
  experiment: Phase4Experiment | null;
  startAttestationId: string | null;
  externalStartAttestationRequired: true;
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
  temporalDiversityGate: Phase4GateStatus;
  dependenceSensitivityGate: Phase4GateStatus;
  distinctUtcDateCount: number;
  maxEpisodesOnSingleUtcDate: number;
  minimumLeaveOneUtcDateOutAccuracy: number | null;
  minimumLeaveOneUtcDateOutWilson95Low: number | null;
  worstExcludedUtcDate: string | null;
  stabilityBlocks: Phase4StabilityBlock[];
  utcDatePerformance: Phase4UtcDatePerformance[];
  leaveOneUtcDateOutPerformance: Phase4LeaveOneUtcDateOutPerformance[];
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
  evidenceBundleSchemaVersion: '2';
  evidenceBundleId: string;
  experimentId: string;
  generatedAt: number;
  scientificCoreSha256: string;
  validationAuthoritySha256: string;
  protocolSha256: string;
  startAttestationId: string;
  bodyChecksumSha256: string;
}

export interface Phase4EvidenceBundle {
  manifest: Phase4EvidenceBundleManifest;
  report: Phase4Report;
  experiment: Phase4Experiment;
  startAttestation: Phase4StartAttestation;
  acceptedEpisodes: Phase4EpisodeRecord[];
  importedDatasets: Phase4DatasetImportRecord[];
  exclusions: Phase4ExclusionRecord[];
  auditEvents: Phase4AuditEvent[];
  evaluations: Phase4Evaluation[];
}
