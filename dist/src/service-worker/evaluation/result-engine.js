import { canonicalEntityHash } from '../../common/hashing/canonical-hash.js';
import { isCompatibleMarketSource } from '../../common/models/market-source-identity.js';
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
        const priceOutcome = tick.price > signal.referenceEntryPrice ? 'UP' : tick.price < signal.referenceEntryPrice ? 'DOWN' : 'FLAT';
        const directionalOutcome = priceOutcome === 'FLAT'
            ? 'FLAT'
            : (signal.direction === 'CALL' && priceOutcome === 'UP') || (signal.direction === 'PUT' && priceOutcome === 'DOWN')
                ? 'CORRECT'
                : 'INCORRECT';
        const payout = signal.payoutSnapshot.payoutRate;
        const economicOutcome = directionalOutcome === 'FLAT'
            ? 'UNKNOWN'
            : payout === null
                ? 'UNKNOWN'
                : directionalOutcome === 'CORRECT' ? 'WIN' : 'LOSS';
        const economicReturn = economicOutcome === 'WIN' ? payout : economicOutcome === 'LOSS' ? -1 : null;
        const resultPayload = {
            signalId: signal.signalId,
            exitTickId: tick.tickId,
            referenceExitTimestamp: tick.eventTimestampEpochMs,
            referenceExitPrice: tick.price,
        };
        return {
            resolutionStatus: 'RESOLVED',
            resultSchemaVersion: '2',
            resultId: canonicalEntityHash('RESULT_RESOLVED', 2, resultPayload),
            signalId: signal.signalId,
            evaluationMode: 'REFERENCE_FEED',
            referenceExitPrice: tick.price,
            referenceExitTimestamp: tick.eventTimestampEpochMs,
            expiryTimingErrorMs: tick.eventTimestampEpochMs - signal.expectedExpiryTimestamp,
            priceOutcome,
            directionalOutcome,
            economicOutcome,
            economicReturn,
            settlementMetadata: {
                settlementMetadataSchemaVersion: '2',
                confidence: economicOutcome === 'UNKNOWN' ? 'UNKNOWN' : 'INFERRED',
                source: economicOutcome === 'UNKNOWN' ? null : 'REFERENCE_PRICE',
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
            resultSchemaVersion: '2',
            resultId: canonicalEntityHash('RESULT_UNRESOLVED', 2, { signalId: signal.signalId, reason }),
            signalId: signal.signalId,
            evaluationMode: 'REFERENCE_FEED',
            referenceExitPrice: null,
            referenceExitTimestamp: null,
            expiryTimingErrorMs: null,
            priceOutcome: 'UNRESOLVED',
            directionalOutcome: 'UNRESOLVED',
            economicOutcome: 'UNKNOWN',
            economicReturn: null,
            settlementMetadata: { settlementMetadataSchemaVersion: '2', confidence: 'UNKNOWN', source: null, verifiedAt: null },
            exitMarketSourceIdentity: tick?.marketSourceIdentity ?? null,
            unresolvedReason: reason,
            evaluatedAt,
        };
    }
}
