import type { MarketSourceIdentity, PayoutSnapshot, SourceQuality, Tick } from '../models/types.js';

export type RuntimeMode = 'PRODUCTION' | 'PROTOCOL_DISCOVERY';
export type ConnectionEventType = 'OPEN' | 'CLOSE' | 'ERROR';

export interface SemanticPriceEvent {
  type: 'SEMANTIC_PRICE';
  connectionId: string;
  sequence: number;
  identity: MarketSourceIdentity;
  price: number;
  sourceTimestampEpochMs: number | null;
  sourceClockSynchronized: boolean;
  sourceQuality: SourceQuality;
  receivedAtEpochMs: number;
  receivedAtMonotonicMs: number;
}

export interface SemanticPayoutEvent {
  type: 'SEMANTIC_PAYOUT';
  connectionId: string;
  sequence: number;
  payoutSnapshot: PayoutSnapshot;
}

export interface SemanticConnectionEvent {
  type: 'CONNECTION';
  connectionId: string;
  event: ConnectionEventType;
  receivedAtEpochMs: number;
}

export interface DiscoveryObservation {
  type: 'DISCOVERY_OBSERVATION';
  connectionId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  payloadType: 'TEXT' | 'BINARY' | 'BLOB' | 'UNKNOWN';
  byteLength: number;
  socketIoEventName: string | null;
  receivedAtEpochMs: number;
}

export type SemanticMarketEvent = SemanticPriceEvent | SemanticPayoutEvent;
export type MainToIsolatedEvent = SemanticMarketEvent | SemanticConnectionEvent | DiscoveryObservation;

export interface ValidatedMarketObservation {
  tick: Tick;
}
