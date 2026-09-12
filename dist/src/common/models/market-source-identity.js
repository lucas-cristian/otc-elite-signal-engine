function symmetricOptionalMatch(left, right) {
    if ((left === null) !== (right === null))
        return 'INSUFFICIENT';
    if (left !== null && right !== null && left !== right)
        return 'MISMATCH';
    return 'MATCH';
}
export function isCompatibleMarketSource(entry, exit) {
    if (entry.platform !== exit.platform)
        return { compatible: false, reason: 'PLATFORM_MISMATCH' };
    if (entry.canonicalAssetId !== exit.canonicalAssetId)
        return { compatible: false, reason: 'ASSET_MISMATCH' };
    if (entry.marketType !== exit.marketType)
        return { compatible: false, reason: 'MARKET_TYPE_MISMATCH' };
    if (!entry.instrumentId || !exit.instrumentId || !entry.parserSchemaId || !exit.parserSchemaId)
        return { compatible: false, reason: 'INSUFFICIENT_IDENTITY' };
    if (entry.instrumentId !== exit.instrumentId)
        return { compatible: false, reason: 'INSTRUMENT_MISMATCH' };
    const feed = symmetricOptionalMatch(entry.feedId, exit.feedId);
    if (feed === 'INSUFFICIENT')
        return { compatible: false, reason: 'INSUFFICIENT_IDENTITY' };
    if (feed === 'MISMATCH')
        return { compatible: false, reason: 'FEED_MISMATCH' };
    if (entry.source !== exit.source || entry.parserSchemaId !== exit.parserSchemaId)
        return { compatible: false, reason: 'SOURCE_SEMANTICS_MISMATCH' };
    return { compatible: true, reason: 'MATCH' };
}
