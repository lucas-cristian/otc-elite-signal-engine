import { canonicalEntityHash } from '../hashing/canonical-hash.js';
import type { SemanticPriceEvent } from '../protocol/market-events.js';
import type { Tick } from '../models/types.js';

export function createValidatedTick(event: SemanticPriceEvent, pageSessionId: string): Tick {
  const sourceTimestamp = event.sourceTimestampEpochMs;
  const observedTimestampDeltaMs = sourceTimestamp === null ? null : event.receivedAtEpochMs - sourceTimestamp;
  const useSourceClock = event.sourceClockSynchronized && sourceTimestamp !== null;
  const eventTimestampEpochMs = useSourceClock ? sourceTimestamp : event.receivedAtEpochMs;
  const timestampBasis = useSourceClock ? 'SOURCE' : 'LOCAL_RECEIPT';
  const integrity = useSourceClock && observedTimestampDeltaMs !== null && Math.abs(observedTimestampDeltaMs) > 60_000 ? 'SUSPECT' : 'VALID';
  const tickId = canonicalEntityHash('TICK', 3, {
    identity: event.identity,
    pageSessionId,
    connectionId: event.connectionId,
    sequence: event.sequence,
    sourceTimestampEpochMs: sourceTimestamp,
    receivedAtEpochMs: event.receivedAtEpochMs,
    price: event.price,
  });
  return {
    tickSchemaVersion: '3',
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
    sourceClockSynchronized: event.sourceClockSynchronized,
    observedTimestampDeltaMs,
    transportLatencyMs: null,
    price: event.price,
    integrity,
    sourceQuality: event.sourceQuality,
  };
}
