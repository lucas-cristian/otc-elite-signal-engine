import {
  ExecutionMode,
  MarketSourceIdentity,
  EntryReferencePolicy,
  DataQuality,
  SourceQuality,
  PriceSource,
} from './types';

export interface StrategyEvaluation {
  strategyId: string;
  strategyVersion: string;
  direction: 'CALL' | 'PUT' | 'NO_TRADE';
  score: number | null;
  weight: number;
}

export interface MarketRegimeSnapshot {
  structure: 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | null;
  volatility: 'HIGH' | 'LOW' | 'NORMAL' | null;
}

export interface EvidenceSnapshot {
  combinedScore: number | null;
  capped: boolean;
}

export interface FeatureSnapshot {
  computedAt: number;
  informationCutoffTimestamp: number;
  usedPartialCandle: boolean;
  partialCandleCutoffTimestamp: number | null;
  features: Record<string, number | null>;
}

export interface DecisionRecord {
  decisionId: string;
  decisionSchemaVersion: string;
  executionMode: ExecutionMode;
  asset: string;
  decisionComputedAt: number;
  decisionPublishedAt: number;
  alertPublishedAt: number | null;
  evaluationWindowId: string;
  candleStartTimestamp: number | null;
  candidateDirection: 'CALL' | 'PUT' | null;
  finalDecision: 'CALL' | 'PUT' | 'NO_TRADE' | 'BLOCKED' | 'DATA_UNAVAILABLE';
  modelScore: number | null;
  calibratedProbability: number | null;
  structureRegime: 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | null;
  volatilityRegime: 'HIGH' | 'LOW' | 'NORMAL' | null;
  strategySnapshots: StrategyEvaluation[] | null;
  featureSnapshot: FeatureSnapshot | null;
  regimeSnapshot: MarketRegimeSnapshot | null;
  evidenceSnapshot: EvidenceSnapshot | null;
  sourceQuality: SourceQuality | null;
  blockers: string[];
  dataQuality: DataQuality;
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
  entryResolutionId: string;
  entryResolutionSchemaVersion: string;
  decisionId: string;
  referenceEntryPrice: number;
  referenceEntryTimestamp: number;
  decisionPublishedAt: number;
  entryDelayMs: number;
  entrySource: PriceSource;
  entryReferencePolicy: EntryReferencePolicy;
  entryMarketSourceIdentity: MarketSourceIdentity;
  entryPageSessionId: string;
  entryTickId: string;
  resolvedAt: number;
}

export interface UnresolvedEntryRecord {
  resolutionStatus: 'UNRESOLVED';
  entryResolutionId: string;
  entryResolutionSchemaVersion: string;
  decisionId: string;
  referenceEntryPrice: null;
  referenceEntryTimestamp: null;
  maxEntryResolutionDelayMs: number;
  unresolvedReason: EntryUnresolvedReason;
  resolvedAt: number;
}

export type EntryResolutionRecord = ResolvedEntryRecord | UnresolvedEntryRecord;

export interface DecisionSignalLink {
  decisionId: string;
  signalId: string;
  linkedAt: number;
}

export interface SignalRecord {
  signalSchemaVersion: string;
  signalId: string;
  signalFingerprint: string;
  decisionId: string;
  executionMode: ExecutionMode;
  asset: string;
  direction: 'CALL' | 'PUT';
  referenceEntryPrice: number;
  referenceEntryTimestamp: number;
  expirationSeconds: number;
  expectedExpiryTimestamp: number;
  entryMarketSourceIdentity: MarketSourceIdentity;
  signalCreatedAt: number;
}

export type PriceOutcome = 'UP' | 'DOWN' | 'FLAT' | 'UNRESOLVED';
export type SignalDirectionalOutcome = 'CORRECT' | 'INCORRECT' | 'FLAT' | 'UNRESOLVED';
export type PlatformSettlementOutcome = 'WIN' | 'LOSS' | 'REFUND' | 'UNKNOWN';

export enum SettlementConfidence {
  VERIFIED = 'VERIFIED',
  INFERRED = 'INFERRED',
  UNKNOWN = 'UNKNOWN'
}

export interface SettlementMetadata {
  settlementMetadataSchemaVersion: string;
  confidence: SettlementConfidence;
  source: 'PLATFORM_PROTOCOL' | 'PLATFORM_DOM' | 'INFERRED_FROM_REFERENCE_PRICE' | null;
  verifiedAt: number | null;
}

export type UnresolvedReason = 'ASSET_FEED_LOST' | 'EXPIRY_TIMEOUT' | 'MARKET_SOURCE_INCOMPATIBLE';

export interface ResolvedResultRecord {
  resolutionStatus: 'RESOLVED';
  resultId: string;
  resultSchemaVersion: string;
  signalId: string;
  evaluationMode: 'REFERENCE_FEED';
  referenceExitPrice: number;
  referenceExitTimestamp: number;
  expiryTimingErrorMs: number;
  priceOutcome: PriceOutcome;
  directionalOutcome: SignalDirectionalOutcome;
  economicOutcome: PlatformSettlementOutcome;
  economicReturn: number | null;
  settlementMetadata: SettlementMetadata;
  exitMarketSourceIdentity: MarketSourceIdentity;
  recoveredAcrossPageSession: boolean;
  entryPageSessionId: string;
  exitPageSessionId: string;
  evaluatedAt: number;
}

export interface UnresolvedResultRecord {
  resolutionStatus: 'UNRESOLVED';
  resultId: string;
  resultSchemaVersion: string;
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
  unresolvedReason: UnresolvedReason;
  evaluatedAt: number;
}

export type ResultRecord = ResolvedResultRecord | UnresolvedResultRecord;
