export type ConnectionEventType = 'OPEN' | 'CLOSE' | 'ERROR';

export type NormalizedMarketEvent = 
  | { type: 'CONNECTION'; connectionId: string; event: ConnectionEventType; timestampMs: number }
  | { type: 'PRICE_FRAME'; connectionId: string; payloadBuffer: Uint8Array; timestampMs: number }
  | { type: 'SUBSCRIPTION_STATE'; connectionId: string; subscriptions: string[]; timestampMs: number };
