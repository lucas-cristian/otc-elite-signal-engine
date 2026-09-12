import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
import { isCompatibleMarketSource } from '../../common/models/market-source-identity.js';
import type {
  EconomicEvaluationReason,
  ResolvedDirectionalOutcome,
  ResolvedPriceOutcome,
  ResultRecord,
  SignalRecord,
} from '../../common/models/journal-types.js';
import type { PayoutSnapshot, Tick } from '../../common/models/types.js';

interface EconomicEvaluation {
  outcome: 'WIN' | 'LOSS' | 'UNKNOWN';
  economicReturn: number | null;
  reason: EconomicEvaluationReason;
}

function evaluateEconomicOutcome(
  signal: SignalRecord,
  directionalOutcome: ResolvedDirectionalOutcome,
): EconomicEvaluation {
  if (directionalOutcome === 'FLAT') {
    return { outcome: 'UNKNOWN', economicReturn: null, reason: 'FLAT_REFERENCE_OUTCOME' };
  }

  const payout: PayoutSnapshot = signal.payoutSnapshot;
  if (payout.payoutRate === null) {
    return { outcome: 'UNKNOWN', economicReturn: null, reason: 'PAYOUT_RATE_MISSING' };
  }
  if (payout.quality !== 'VERIFIED') {
    return { outcome: 'UNKNOWN', economicReturn: null, reason: 'PAYOUT_UNVERIFIED' };
  }
  if (payout.expirationSeconds === null) {
    return { outcome: 'UNKNOWN', economicReturn: null, reason: 'PAYOUT_EXPIRATION_UNKNOWN' };
  }
  if (payout.expirationSeconds !== signal.expirationSeconds) {
    return { outcome: 'UNKNOWN', economicReturn: null, reason: 'PAYOUT_EXPIRATION_MISMATCH' };
  }

  if (directionalOutcome === 'CORRECT') {
    return { outcome: 'WIN', economicReturn: payout.payoutRate, reason: 'ELIGIBLE' };
  }
  return { outcome: 'LOSS', economicReturn: -1, reason: 'ELIGIBLE' };
}

export class ResultEngine {
  public constructor(private readonly maxExpiryResolutionDelayMs: number) {}

  public evaluateFromTick(signal: SignalRecord, tick: Tick): ResultRecord | null {
    if (tick.eventTimestampEpochMs < signal.expectedExpiryTimestamp) return null;
    if (tick.eventTimestampEpochMs > signal.expectedExpiryTimestamp + this.maxExpiryResolutionDelayMs) {
      return this.unresolved(signal, 'EXPIRY_TIMEOUT', tick.receivedAtEpochMs, null);
    }
    if (tick.marketSourceIdentity.canonicalAssetId !== signal.canonicalAssetId) return null;
    const compatibility = isCompatibleMarketSource(signal.entryMarketSourceIdentity, tick.marketSourceIdentity);
    if (!compatibility.compatible) return this.unresolved(signal, 'MARKET_SOURCE_INCOMPATIBLE', tick.receivedAtEpochMs, tick);
    if (tick.integrity !== 'VALID') return this.unresolved(signal, 'DATA_UNAVAILABLE', tick.receivedAtEpochMs, tick);

    const priceOutcome: ResolvedPriceOutcome = tick.price > signal.referenceEntryPrice
      ? 'UP'
      : tick.price < signal.referenceEntryPrice
        ? 'DOWN'
        : 'FLAT';
    const directionalOutcome: ResolvedDirectionalOutcome = priceOutcome === 'FLAT'
      ? 'FLAT'
      : (signal.direction === 'CALL' && priceOutcome === 'UP') || (signal.direction === 'PUT' && priceOutcome === 'DOWN')
        ? 'CORRECT'
        : 'INCORRECT';
    const economic = evaluateEconomicOutcome(signal, directionalOutcome);
    const resultPayload = {
      signalId: signal.signalId,
      exitTickId: tick.tickId,
      referenceExitTimestamp: tick.eventTimestampEpochMs,
      referenceExitPrice: tick.price,
    };

    return {
      resolutionStatus: 'RESOLVED',
      resultSchemaVersion: '3',
      resultId: canonicalEntityHash('RESULT_RESOLVED', 3, resultPayload),
      signalId: signal.signalId,
      evaluationMode: 'REFERENCE_FEED',
      referenceExitPrice: tick.price,
      referenceExitTimestamp: tick.eventTimestampEpochMs,
      expiryTimingErrorMs: tick.eventTimestampEpochMs - signal.expectedExpiryTimestamp,
      priceOutcome,
      directionalOutcome,
      economicOutcome: economic.outcome,
      economicReturn: economic.economicReturn,
      economicEvaluationReason: economic.reason,
      settlementMetadata: {
        settlementMetadataSchemaVersion: '2',
        confidence: economic.reason === 'ELIGIBLE' ? 'INFERRED' : 'UNKNOWN',
        source: economic.reason === 'ELIGIBLE' ? 'REFERENCE_PRICE' : null,
        verifiedAt: null,
      },
      exitMarketSourceIdentity: tick.marketSourceIdentity,
      recoveredAcrossPageSession: signal.entryPageSessionId !== tick.pageSessionId,
      entryPageSessionId: signal.entryPageSessionId,
      exitPageSessionId: tick.pageSessionId,
      evaluatedAt: tick.receivedAtEpochMs,
    };
  }

  public timeout(signal: SignalRecord, nowMs: number): ResultRecord | null {
    if (nowMs <= signal.expectedExpiryTimestamp + this.maxExpiryResolutionDelayMs) return null;
    return this.unresolved(signal, 'EXPIRY_TIMEOUT', nowMs, null);
  }

  private unresolved(
    signal: SignalRecord,
    reason: 'EXPIRY_TIMEOUT' | 'MARKET_SOURCE_INCOMPATIBLE' | 'DATA_UNAVAILABLE',
    evaluatedAt: number,
    tick: Tick | null,
  ): ResultRecord {
    return {
      resolutionStatus: 'UNRESOLVED',
      resultSchemaVersion: '3',
      resultId: canonicalEntityHash('RESULT_UNRESOLVED', 3, { signalId: signal.signalId, reason }),
      signalId: signal.signalId,
      evaluationMode: 'REFERENCE_FEED',
      referenceExitPrice: null,
      referenceExitTimestamp: null,
      expiryTimingErrorMs: null,
      priceOutcome: 'UNRESOLVED',
      directionalOutcome: 'UNRESOLVED',
      economicOutcome: 'UNKNOWN',
      economicReturn: null,
      economicEvaluationReason: 'RESULT_UNRESOLVED',
      settlementMetadata: { settlementMetadataSchemaVersion: '2', confidence: 'UNKNOWN', source: null, verifiedAt: null },
      exitMarketSourceIdentity: tick?.marketSourceIdentity ?? null,
      unresolvedReason: reason,
      evaluatedAt,
    };
  }
}
