import type {
  EventIntegrity,
  ExecutionMode,
  MarketSourceIdentity,
  OperationalDataState,
  PayoutSnapshot,
  SourceQuality,
  StructureRegime,
  Timeframe,
  VolatilityRegime,
} from './types.js';

export type SignalDirection = 'CALL' | 'PUT';
export type FinalDecision = SignalDirection | 'NO_TRADE' | 'BLOCKED' | 'DATA_UNAVAILABLE';
export type EvidenceFamily = 'MOMENTUM' | 'REJECTION' | 'TICK_FLOW' | 'STRUCTURE' | 'REGIME' | 'DISTANCE' | 'CLASSICAL';

export interface FeatureSnapshot {
  featureSchemaVersion: '2';
  computedAt: number;
  informationCutoffTimestamp: number;
  usedPartialCandle: boolean;
  partialCandleCutoffTimestamp: number | null;
  features: Record<string, number | null>;
}

export interface MarketRegimeSnapshot {
  structure: StructureRegime;
  volatility: VolatilityRegime;
}

export interface StrategyEvaluation {
  strategyId: string;
  strategyVersion: string;
  direction: SignalDirection | 'NO_TRADE';
  rawScore: number;
  evidence: EvidenceContribution[];
  blockers: string[];
}

export interface EvidenceContribution {
  family: EvidenceFamily;
  direction: SignalDirection;
  strength: number;
}

export interface EvidenceSnapshot {
  evidenceSchemaVersion: '2';
  familyScores: Partial<Record<EvidenceFamily, number>>;
  modelScore: number;
  dominantDirection: SignalDirection | null;
  denominator: number;
  clipped: boolean;
}

export interface EvaluationWindow {
  evaluationWindowId: string;
  canonicalAssetId: string;
  timeframe: Timeframe;
  candleStartTimestamp: number;
  windowStartTimestamp: number;
  windowEndTimestamp: number;
  expirationSeconds: number;
  configHash: string;
}

export interface DecisionRecord {
  decisionSchemaVersion: '2';
  decisionId: string;
  decisionGranularityKey: string;
  executionMode: ExecutionMode;
  canonicalAssetId: string;
  timeframe: Timeframe;
  decisionComputedAt: number;
  decisionPublishedAt: number;
  alertPublishedAt: number | null;
  evaluationWindowId: string;
  candleStartTimestamp: number;
  candidateDirection: SignalDirection | null;
  finalDecision: FinalDecision;
  modelScore: number | null;
  calibratedProbability: null;
  structureRegime: StructureRegime;
  volatilityRegime: VolatilityRegime;
  strategySnapshots: StrategyEvaluation[];
  featureSnapshot: FeatureSnapshot | null;
  evidenceSnapshot: EvidenceSnapshot | null;
  sourceQuality: SourceQuality;
  eventIntegrity: EventIntegrity;
  operationalDataState: OperationalDataState;
  blockers: string[];
  expirationSeconds: number;
  configHash: string;
  configSnapshot: Record<string, unknown>;
  appVersion: string;
  marketEpisodeId: string | null;
  createdAt: number;
}

export type EntryUnresolvedReason = 'ENTRY_TIMEOUT' | 'FEED_STALE' | 'DATA_UNAVAILABLE' | 'ASSET_CHANGED' | 'EXTENSION_CONTEXT_LOST';

export interface ResolvedEntryRecord {
  resolutionStatus: 'RESOLVED';
  entryResolutionSchemaVersion: '2';
  entryResolutionId: string;
  decisionId: string;
  referenceEntryPrice: number;
  referenceEntryTimestamp: number;
  decisionPublishedAt: number;
  entryDelayMs: number;
  entryReferencePolicy: 'FIRST_TICK_AFTER_ALERT';
  entryMarketSourceIdentity: MarketSourceIdentity;
  entryPageSessionId: string;
  entryTickId: string;
  resolvedAt: number;
}

export interface UnresolvedEntryRecord {
  resolutionStatus: 'UNRESOLVED';
  entryResolutionSchemaVersion: '2';
  entryResolutionId: string;
  decisionId: string;
  referenceEntryPrice: null;
  referenceEntryTimestamp: null;
  maxEntryResolutionDelayMs: number;
  unresolvedReason: EntryUnresolvedReason;
  resolvedAt: number;
}

export type EntryResolutionRecord = ResolvedEntryRecord | UnresolvedEntryRecord;

export interface SignalRecord {
  signalSchemaVersion: '2';
  signalId: string;
  signalFingerprint: string;
  decisionId: string;
  executionMode: ExecutionMode;
  canonicalAssetId: string;
  direction: SignalDirection;
  referenceEntryPrice: number;
  referenceEntryTimestamp: number;
  expirationSeconds: number;
  expectedExpiryTimestamp: number;
  entryMarketSourceIdentity: MarketSourceIdentity;
  entryPageSessionId: string;
  payoutSnapshot: PayoutSnapshot;
  signalCreatedAt: number;
}

export interface DecisionSignalLink {
  decisionId: string;
  signalId: string;
  linkedAt: number;
}

export type ResolvedPriceOutcome = 'UP' | 'DOWN' | 'FLAT';
export type ResolvedDirectionalOutcome = 'CORRECT' | 'INCORRECT' | 'FLAT';
export type PlatformSettlementOutcome = 'WIN' | 'LOSS' | 'REFUND' | 'UNKNOWN';
export type SettlementConfidence = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';

export interface SettlementMetadata {
  settlementMetadataSchemaVersion: '2';
  confidence: SettlementConfidence;
  source: 'PLATFORM_PROTOCOL' | 'PLATFORM_DOM' | 'REFERENCE_PRICE' | null;
  verifiedAt: number | null;
}

export interface ResolvedResultRecord {
  resolutionStatus: 'RESOLVED';
  resultSchemaVersion: '2';
  resultId: string;
  signalId: string;
  evaluationMode: 'REFERENCE_FEED';
  referenceExitPrice: number;
  referenceExitTimestamp: number;
  expiryTimingErrorMs: number;
  priceOutcome: ResolvedPriceOutcome;
  directionalOutcome: ResolvedDirectionalOutcome;
  economicOutcome: PlatformSettlementOutcome;
  economicReturn: number | null;
  settlementMetadata: SettlementMetadata;
  exitMarketSourceIdentity: MarketSourceIdentity;
  recoveredAcrossPageSession: boolean;
  entryPageSessionId: string;
  exitPageSessionId: string;
  evaluatedAt: number;
}

export type ResultUnresolvedReason = 'ASSET_FEED_LOST' | 'EXPIRY_TIMEOUT' | 'MARKET_SOURCE_INCOMPATIBLE' | 'DATA_UNAVAILABLE';

export interface UnresolvedResultRecord {
  resolutionStatus: 'UNRESOLVED';
  resultSchemaVersion: '2';
  resultId: string;
  signalId: string;
  evaluationMode: 'REFERENCE_FEED';
  referenceExitPrice: null;
  referenceExitTimestamp: null;
  expiryTimingErrorMs: null;
  priceOutcome: 'UNRESOLVED';
  directionalOutcome: 'UNRESOLVED';
  economicOutcome: 'UNKNOWN';
  economicReturn: null;
  settlementMetadata: SettlementMetadata;
  exitMarketSourceIdentity: MarketSourceIdentity | null;
  unresolvedReason: ResultUnresolvedReason;
  evaluatedAt: number;
}

export type ResultRecord = ResolvedResultRecord | UnresolvedResultRecord;
