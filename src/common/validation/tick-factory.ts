import { canonicalEntityHash } from '../hashing/canonical-hash.js';
import type { SemanticPriceEvent } from '../protocol/market-events.js';
import type { Tick } from '../models/types.js';

export function createValidatedTick(event: SemanticPriceEvent, pageSessionId: string): Tick {
  const sourceTimestamp = event.sourceTimestampEpochMs;
  const eventTimestampEpochMs = sourceTimestamp ?? event.receivedAtEpochMs;
  const observedTimestampDeltaMs = sourceTimestamp === null ? null : event.receivedAtEpochMs - sourceTimestamp;
  const integrity = observedTimestampDeltaMs !== null && Math.abs(observedTimestampDeltaMs) > 60_000 ? 'SUSPECT' : 'VALID';
  const timestampBasis = sourceTimestamp === null ? 'LOCAL_RECEIPT' : 'SOURCE';
  const tickId = canonicalEntityHash('TICK', 2, {
    identity: event.identity,
    pageSessionId,
    connectionId: event.connectionId,
    sequence: event.sequence,
    sourceTimestampEpochMs: sourceTimestamp,
    receivedAtEpochMs: event.receivedAtEpochMs,
    price: event.price,
  });
  return {
    tickSchemaVersion: '2',
    tickId,
    marketSourceIdentity: event.identity,
    pageSessionId,
    connectionId: event.connectionId,
    sequence: event.sequence,
    sourceTimestampEpochMs: sourceTimestamp,
    receivedAtEpochMs: event.receivedAtEpochMs,
    receivedAtMonotonicMs: event.receivedAtMonotonicMs,
    eventTimestampEpochMs,
    timestampBasis,
    observedTimestampDeltaMs,
    transportLatencyMs: null,
    price: event.price,
    integrity,
  };
}
