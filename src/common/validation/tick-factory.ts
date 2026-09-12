import { canonicalEntityHash } from '../hashing/canonical-hash.js';
import type { SemanticPriceEvent } from '../protocol/market-events.js';
import type { Tick } from '../models/types.js';

export function createValidatedTick(event: SemanticPriceEvent, pageSessionId: string): Tick {
  const sourceTimestamp = event.sourceTimestampEpochMs;
  const sourceClockSynchronized = event.sourceClockSynchronized;
  const eventTimestampEpochMs = sourceTimestamp !== null && sourceClockSynchronized ? sourceTimestamp : event.receivedAtEpochMs;
  const observedTimestampDeltaMs = sourceTimestamp === null ? null : event.receivedAtEpochMs - sourceTimestamp;
  const integrity = event.sourceQuality === 'UNKNOWN' ? 'SUSPECT' : 'VALID';
  const timestampBasis = sourceTimestamp !== null && sourceClockSynchronized ? 'SOURCE' : 'LOCAL_RECEIPT';
  const tickId = canonicalEntityHash('TICK', 4, {
    identity: event.identity,
    pageSessionId,
    connectionId: event.connectionId,
    sequence: event.sequence,
    sourceTimestampEpochMs: sourceTimestamp,
    receivedAtEpochMs: event.receivedAtEpochMs,
    price: event.price,
    sourceQuality: event.sourceQuality,
    protocolVerificationId: event.protocolVerificationId,
  });
  return {
    tickSchemaVersion: '4',
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
    sourceClockSynchronized,
    observedTimestampDeltaMs,
    transportLatencyMs: sourceTimestamp !== null && sourceClockSynchronized ? Math.max(0, observedTimestampDeltaMs ?? 0) : null,
    price: event.price,
    integrity,
    sourceQuality: event.sourceQuality,
    protocolVerificationId: event.protocolVerificationId,
  };
}
