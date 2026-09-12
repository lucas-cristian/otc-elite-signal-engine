import { MarketSourceIdentity } from './types';
import { getCanonicalAssetId } from '../hashing/canonical-hash';

export interface MarketSourceCompatibility {
  compatible: boolean;
  reason: 
    | 'MATCH' 
    | 'PLATFORM_MISMATCH' 
    | 'ASSET_MISMATCH' 
    | 'MARKET_TYPE_MISMATCH' 
    | 'INSTRUMENT_MISMATCH' 
    | 'FEED_MISMATCH' 
    | 'SOURCE_SEMANTICS_MISMATCH' 
    | 'INSUFFICIENT_IDENTITY';
}

export function isCompatibleMarketSource(entry: MarketSourceIdentity, exit: MarketSourceIdentity): MarketSourceCompatibility {
  if (entry.platform !== exit.platform) {
    return { compatible: false, reason: 'PLATFORM_MISMATCH' };
  }
  
  if (getCanonicalAssetId(entry.asset) !== getCanonicalAssetId(exit.asset)) {
    return { compatible: false, reason: 'ASSET_MISMATCH' };
  }
  
  if (entry.marketType !== exit.marketType) {
    return { compatible: false, reason: 'MARKET_TYPE_MISMATCH' };
  }
  
  if (entry.instrumentId !== null && exit.instrumentId !== null && entry.instrumentId !== exit.instrumentId) {
    return { compatible: false, reason: 'INSTRUMENT_MISMATCH' };
  }
  
  if (entry.feedId !== null && exit.feedId !== null && entry.feedId !== exit.feedId) {
    return { compatible: false, reason: 'FEED_MISMATCH' };
  }
  
  if (entry.parserSchemaId !== null && exit.parserSchemaId !== null && entry.parserSchemaId !== exit.parserSchemaId) {
    return { compatible: false, reason: 'SOURCE_SEMANTICS_MISMATCH' };
  }
  
  // Rejeição por identidade insuficiente caso campos vitais estejam faltando em ambos e o source em si
  // não for estritamente idêntico ou requerer ids extras.
  if (entry.instrumentId === null && exit.instrumentId === null && entry.feedId === null && exit.feedId === null) {
    return { compatible: false, reason: 'INSUFFICIENT_IDENTITY' };
  }

  return { compatible: true, reason: 'MATCH' };
}
