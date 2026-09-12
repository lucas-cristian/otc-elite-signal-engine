import { describe, it, expect } from 'vitest';
import { canonicalJson, canonicalEntityHash, getCanonicalAssetId, canonicalHashVersion } from '../../src/common/hashing/canonical-hash';

describe('canonicalJson', () => {
  it('should order keys recursively', () => {
    const obj1 = { b: 2, a: 1, c: { z: 26, y: 25 } };
    const obj2 = { a: 1, c: { y: 25, z: 26 }, b: 2 };
    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
    expect(canonicalJson(obj1)).toBe('{"a":1,"b":2,"c":{"y":25,"z":26}}');
  });

  it('should maintain array order', () => {
    const arr1 = [1, 2, 3];
    const arr2 = [3, 2, 1];
    expect(canonicalJson(arr1)).not.toBe(canonicalJson(arr2));
  });

  it('should reject undefined, NaN, Infinity, and Date', () => {
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
  });

  it('should normalize -0 to 0', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(0)).toBe('0');
  });
});

describe('canonicalEntityHash', () => {
  it('should produce deterministic hash with domain separation', () => {
    const payload = { b: 2, a: 1 };
    const hash1 = canonicalEntityHash('TEST', canonicalHashVersion, payload);
    const hash2 = canonicalEntityHash('TEST', canonicalHashVersion, { a: 1, b: 2 });
    expect(hash1).toBe(hash2);
    
    // Domain separation should yield different hash
    const hash3 = canonicalEntityHash('OTHER', canonicalHashVersion, payload);
    expect(hash1).not.toBe(hash3);
  });
});

describe('getCanonicalAssetId', () => {
  it('should normalize asset symbols', () => {
    expect(getCanonicalAssetId('EUR/USD OTC')).toBe('EURUSDOTC');
    expect(getCanonicalAssetId('EURUSD_otc')).toBe('EURUSDOTC');
    expect(getCanonicalAssetId('eur-usd')).toBe('EURUSD');
  });
});
