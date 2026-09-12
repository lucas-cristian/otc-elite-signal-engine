export type TimestampBasis = 'SOURCE_RECEIVED' | 'LOCAL_RECEIVED' | 'HYBRID';
export type DataQuality = 'OPTIMAL' | 'DEGRADED' | 'INVALID';
export type SourceQuality = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
export type PriceSource = 'WS_BINARY' | 'WS_JSON' | 'DOM_OBSERVATION';
export type EntryReferencePolicy = 'FIRST_TICK_AFTER_ALERT' | 'NEXT_CANDLE_OPEN';
export type ExpiryPolicy = 'FIXED_DELAY_FROM_ENTRY' | 'FIXED_TIMESTAMP';
export type ExecutionMode = 'LIVE' | 'REPLAY';
export type Timeframe = 'M1' | 'M5' | 'M15';

export interface MarketSourceIdentity {
  marketSourceIdentitySchemaVersion: string;
  platform: 'POCKET_OPTION';
  asset: string;
  marketType: 'OTC';
  source: PriceSource;
  feedId: string | null;
  instrumentId: string | null;
  parserSchemaId: string | null;
}

export interface Tick {
  tickSchemaVersion: string;
  tickId: string;
  marketSourceIdentity: MarketSourceIdentity;
  pageSessionId: string;
  eventTimestamp: number;
  price: number;
  timestampBasis: TimestampBasis;
}

export enum CandleLifecycle {
  FORMING = 'FORMING',
  CLOSED = 'CLOSED',
  EMPTY_INTERVAL = 'EMPTY_INTERVAL'
}

export interface Candle {
  candleSchemaVersion: string;
  asset: string;
  timeframe: string;
  startTimestamp: number;
  endTimestamp: number;
  lifecycle: CandleLifecycle;
  gapAffected: boolean;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  tickCount: number;
  timestampBasis: TimestampBasis;
}
