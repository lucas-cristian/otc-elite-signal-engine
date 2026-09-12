import type { SemanticPriceEvent } from '../protocol/market-events.js';

export function isSemanticPriceEvent(value: unknown): value is SemanticPriceEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (event.type !== 'SEMANTIC_PRICE') return false;
  if (typeof event.connectionId !== 'string' || event.connectionId.length === 0) return false;
  if (!Number.isInteger(event.sequence) || (event.sequence as number) < 0) return false;
  if (typeof event.price !== 'number' || !Number.isFinite(event.price) || event.price <= 0) return false;
  if (event.sourceTimestampEpochMs !== null && (typeof event.sourceTimestampEpochMs !== 'number' || !Number.isFinite(event.sourceTimestampEpochMs))) return false;
  if (typeof event.receivedAtEpochMs !== 'number' || !Number.isFinite(event.receivedAtEpochMs)) return false;
  if (typeof event.receivedAtMonotonicMs !== 'number' || !Number.isFinite(event.receivedAtMonotonicMs)) return false;
  if (typeof event.identity !== 'object' || event.identity === null) return false;
  const identity = event.identity as Record<string, unknown>;
  return identity.marketSourceIdentitySchemaVersion === '2'
    && identity.platform === 'POCKET_OPTION'
    && typeof identity.canonicalAssetId === 'string'
    && identity.canonicalAssetId.length > 0
    && identity.marketType === 'OTC'
    && identity.source === 'POCKET_OPTION_WS_JSON'
    && typeof identity.instrumentId === 'string'
    && identity.instrumentId.length > 0
    && typeof identity.parserSchemaId === 'string'
    && identity.parserSchemaId.length > 0
    && (identity.feedId === null || typeof identity.feedId === 'string');
}
