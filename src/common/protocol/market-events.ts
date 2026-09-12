import type { ShadowFeedState, TransportEventType } from '../models/runtime-telemetry.js';
import type { MarketSourceIdentity, PayoutSnapshot, SourceQuality, Tick } from '../models/types.js';

export type RuntimeMode = 'PRODUCTION' | 'PROTOCOL_DISCOVERY';
export type ConnectionEventType = 'OPEN' | 'CLOSE' | 'ERROR';
export type ConnectionTransportRole = 'PAGE' | 'SHADOW';
export type ShadowControlCommand = 'ENSURE_CONNECTED' | 'FORCE_RECONNECT' | 'RESET_CIRCUIT';

export interface SemanticPriceEvent {
  type: 'SEMANTIC_PRICE';
  connectionId: string;
  sequence: number;
  identity: MarketSourceIdentity;
  price: number;
  sourceTimestampEpochMs: number | null;
  sourceClockSynchronized: boolean;
  sourceQuality: SourceQuality;
  protocolVerificationId: string | null;
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
  transportRole: ConnectionTransportRole;
  event: ConnectionEventType;
  feedHost: string | null;
  receivedAtEpochMs: number;
}

export interface ShadowBridgeTransportEvent {
  type: 'SHADOW_TRANSPORT';
  eventType: TransportEventType;
  occurredAt: number;
  connectionId: string | null;
  endpointHost: string | null;
  state: ShadowFeedState;
  connected: boolean;
  primary: boolean;
  reconnectAttempts: number;
  consecutiveNamespaceRejects: number;
  circuitOpen: boolean;
  lastMessageAt: number | null;
  lastPriceAt: number | null;
  lastErrorReason: string | null;
  reason: string | null;
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
export type MainToIsolatedEvent = SemanticMarketEvent | SemanticConnectionEvent | ShadowBridgeTransportEvent | DiscoveryObservation;

export interface ValidatedMarketObservation {
  tick: Tick;
}
