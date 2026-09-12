import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
import { isCompatibleMarketSource } from '../../common/models/market-source-identity.js';
function evaluateEconomicOutcome(signal, directionalOutcome) {
    if (directionalOutcome === 'FLAT') {
        return { outcome: 'UNKNOWN', economicReturn: null, reason: 'FLAT_REFERENCE_OUTCOME' };
    }
    const payout = signal.payoutSnapshot;
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
    maxExpiryResolutionDelayMs;
    constructor(maxExpiryResolutionDelayMs) {
        this.maxExpiryResolutionDelayMs = maxExpiryResolutionDelayMs;
    }
    evaluateFromTick(signal, tick) {
        if (tick.eventTimestampEpochMs < signal.expectedExpiryTimestamp)
            return null;
        if (tick.eventTimestampEpochMs > signal.expectedExpiryTimestamp + this.maxExpiryResolutionDelayMs) {
            return this.unresolved(signal, 'EXPIRY_TIMEOUT', tick.receivedAtEpochMs, null);
        }
        if (tick.marketSourceIdentity.canonicalAssetId !== signal.canonicalAssetId)
            return null;
        const compatibility = isCompatibleMarketSource(signal.entryMarketSourceIdentity, tick.marketSourceIdentity);
        if (!compatibility.compatible)
            return this.unresolved(signal, 'MARKET_SOURCE_INCOMPATIBLE', tick.receivedAtEpochMs, tick);
        if (tick.integrity !== 'VALID')
            return this.unresolved(signal, 'DATA_UNAVAILABLE', tick.receivedAtEpochMs, tick);
        const priceOutcome = tick.price > signal.referenceEntryPrice
            ? 'UP'
            : tick.price < signal.referenceEntryPrice
                ? 'DOWN'
                : 'FLAT';
        const directionalOutcome = priceOutcome === 'FLAT'
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
    timeout(signal, nowMs) {
        if (nowMs <= signal.expectedExpiryTimestamp + this.maxExpiryResolutionDelayMs)
            return null;
        return this.unresolved(signal, 'EXPIRY_TIMEOUT', nowMs, null);
    }
    unresolved(signal, reason, evaluatedAt, tick) {
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
