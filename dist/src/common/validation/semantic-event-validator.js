function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isSourceQuality(value) {
    return value === 'VERIFIED' || value === 'INFERRED' || value === 'UNKNOWN';
}
function validVerificationPair(quality, verificationId) {
    if (quality === 'VERIFIED')
        return typeof verificationId === 'string' && verificationId.length > 0;
    return verificationId === null;
}
export function isSemanticPriceEvent(value) {
    if (!isRecord(value) || value.type !== 'SEMANTIC_PRICE')
        return false;
    if (typeof value.connectionId !== 'string' || value.connectionId.length === 0)
        return false;
    if (!Number.isInteger(value.sequence) || value.sequence < 0)
        return false;
    if (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price <= 0)
        return false;
    if (value.sourceTimestampEpochMs !== null && (typeof value.sourceTimestampEpochMs !== 'number' || !Number.isFinite(value.sourceTimestampEpochMs)))
        return false;
    if (typeof value.sourceClockSynchronized !== 'boolean' || !isSourceQuality(value.sourceQuality))
        return false;
    if (!validVerificationPair(value.sourceQuality, value.protocolVerificationId))
        return false;
    if (typeof value.receivedAtEpochMs !== 'number' || !Number.isFinite(value.receivedAtEpochMs))
        return false;
    if (typeof value.receivedAtMonotonicMs !== 'number' || !Number.isFinite(value.receivedAtMonotonicMs))
        return false;
    if (!isRecord(value.identity))
        return false;
    const identity = value.identity;
    return identity.marketSourceIdentitySchemaVersion === '2'
        && identity.platform === 'POCKET_OPTION'
        && typeof identity.canonicalAssetId === 'string'
        && identity.canonicalAssetId.length > 0
        && identity.marketType === 'OTC'
        && identity.source === 'POCKET_OPTION_WS_SOCKETIO_BINARY_JSON'
        && typeof identity.instrumentId === 'string'
        && identity.instrumentId.toLowerCase().endsWith('_otc')
        && typeof identity.parserSchemaId === 'string'
        && identity.parserSchemaId.length > 0
        && typeof identity.feedId === 'string'
        && identity.feedId.endsWith('.po.market');
}
export function isSemanticPayoutEvent(value) {
    if (!isRecord(value) || value.type !== 'SEMANTIC_PAYOUT')
        return false;
    if (typeof value.connectionId !== 'string' || value.connectionId.length === 0)
        return false;
    if (!Number.isInteger(value.sequence) || value.sequence < 0)
        return false;
    if (!isRecord(value.payoutSnapshot))
        return false;
    const payout = value.payoutSnapshot;
    return payout.payoutSnapshotSchemaVersion === '3'
        && typeof payout.canonicalAssetId === 'string'
        && payout.canonicalAssetId.length > 0
        && payout.expirationSeconds === null
        && payout.expirationBinding === 'UNBOUND'
        && typeof payout.payoutRate === 'number'
        && Number.isFinite(payout.payoutRate)
        && payout.payoutRate >= 0
        && payout.payoutRate <= 1
        && typeof payout.capturedAt === 'number'
        && Number.isFinite(payout.capturedAt)
        && payout.source === 'PLATFORM_PROTOCOL'
        && isSourceQuality(payout.quality)
        && validVerificationPair(payout.quality, payout.protocolVerificationId)
        && typeof payout.feedId === 'string'
        && payout.feedId.endsWith('.po.market')
        && typeof payout.parserSchemaId === 'string'
        && payout.parserSchemaId.length > 0;
}
