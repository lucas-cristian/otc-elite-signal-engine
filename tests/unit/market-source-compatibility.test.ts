import { describe, it, expect, vi } from 'vitest';
import { MarketSourceIdentity } from '../../src/common/models/types';
import { isCompatibleMarketSource } from '../../src/common/models/market-source-identity';

describe('isCompatibleMarketSource', () => {
  const baseIdentity: MarketSourceIdentity = {
    marketSourceIdentitySchemaVersion: '1',
    platform: 'POCKET_OPTION',
    asset: 'EUR/USD OTC',
    marketType: 'OTC',
    source: 'WS_JSON',
    feedId: 'feed-1',
    instrumentId: 'inst-1',
    parserSchemaId: 'schema-1'
  };

  it('should return MATCH for identical identities', () => {
    const exit = { ...baseIdentity };
    const result = isCompatibleMarketSource(baseIdentity, exit);
    expect(result.compatible).toBe(true);
    expect(result.reason).toBe('MATCH');
  });

  it('should return PLATFORM_MISMATCH for different platforms', () => {
    const exit = { ...baseIdentity, platform: 'OTHER_PLATFORM' as any };
    const result = isCompatibleMarketSource(baseIdentity, exit);
    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('PLATFORM_MISMATCH');
  });

  it('should ignore asset formatting differences via canonical id', () => {
    const exit = { ...baseIdentity, asset: 'EURUSD_otc' };
    const result = isCompatibleMarketSource(baseIdentity, exit);
    expect(result.compatible).toBe(true);
    expect(result.reason).toBe('MATCH');
  });

  it('should return ASSET_MISMATCH for different canonical assets', () => {
    const exit = { ...baseIdentity, asset: 'GBPUSD_otc' };
    const result = isCompatibleMarketSource(baseIdentity, exit);
    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('ASSET_MISMATCH');
  });

  it('should return INSUFFICIENT_IDENTITY if critical fields are null', () => {
    const entry = { ...baseIdentity, feedId: null, instrumentId: null };
    const exit = { ...baseIdentity, feedId: null, instrumentId: null };
    const result = isCompatibleMarketSource(entry, exit);
    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_IDENTITY');
  });
});
