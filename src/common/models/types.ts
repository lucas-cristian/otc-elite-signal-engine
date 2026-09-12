export type TimestampBasis = 'SOURCE' | 'LOCAL_RECEIPT';
export type EventIntegrity = 'VALID' | 'SUSPECT' | 'INVALID';
export type OperationalDataState = 'INITIALIZING' | 'WARMING_UP' | 'HEALTHY' | 'DEGRADED' | 'STALE' | 'DATA_UNAVAILABLE';
export type SourceQuality = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
export type PriceSource = 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON';
export type ExecutionMode = 'LIVE' | 'REPLAY';
export type EntryReferencePolicy = 'FIRST_TICK_AFTER_ALERT';
export type ExpiryPolicy = 'FIXED_DELAY_FROM_ENTRY';
export type Timeframe = '5s' | '10s' | '15s' | '30s' | '60s';
export type StructureRegime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'CHAOTIC' | 'UNKNOWN';
export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'UNKNOWN';
export type PayoutExpirationBinding = 'UNBOUND' | 'EXPLICIT_PROTOCOL' | 'EXPLICIT_DOM';

export interface MarketSourceIdentity {
  marketSourceIdentitySchemaVersion: '2';
  platform: 'POCKET_OPTION';
  canonicalAssetId: string;
  marketType: 'OTC';
  source: PriceSource;
  feedId: string;
  instrumentId: string;
  parserSchemaId: string;
}

export interface Tick {
  tickSchemaVersion: '4';
  tickId: string;
  marketSourceIdentity: MarketSourceIdentity;
  pageSessionId: string;
  connectionId: string;
  sequence: number;
  sourceTimestampEpochMs: number | null;
  receivedAtEpochMs: number;
  receivedAtMonotonicMs: number;
  eventTimestampEpochMs: number;
  timestampBasis: TimestampBasis;
  sourceClockSynchronized: boolean;
  observedTimestampDeltaMs: number | null;
  transportLatencyMs: number | null;
  price: number;
  integrity: EventIntegrity;
  sourceQuality: SourceQuality;
  protocolVerificationId: string | null;
}

export type CandleLifecycle = 'FORMING' | 'CLOSED' | 'EMPTY_INTERVAL';
export type CandleQuality = 'CLEAN' | 'GAP_AFFECTED';

export interface Candle {
  candleSchemaVersion: '2';
  canonicalAssetId: string;
  timeframe: Timeframe;
  startTimestamp: number;
  endTimestamp: number;
  lifecycle: CandleLifecycle;
  quality: CandleQuality;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  tickCount: number;
  timestampBasis: TimestampBasis;
}

export interface PayoutSnapshot {
  payoutSnapshotSchemaVersion: '3';
  canonicalAssetId: string;
  expirationSeconds: number | null;
  expirationBinding: PayoutExpirationBinding;
  payoutRate: number | null;
  capturedAt: number;
  source: 'PLATFORM_PROTOCOL' | 'PLATFORM_DOM' | 'UNKNOWN';
  quality: SourceQuality;
  feedId: string | null;
  parserSchemaId: string | null;
  protocolVerificationId: string | null;
}
