import { sha256 } from './sha256.js';

type CanonicalPrimitive = string | number | boolean | null;
type CanonicalValue = CanonicalPrimitive | CanonicalValue[] | { [key: string]: CanonicalValue };

function normalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite numbers are not canonical');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const result: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(value as object).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member === undefined) throw new TypeError('undefined is not canonical');
      result[key] = normalize(member);
    }
    return result;
  }
  throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function canonicalEntityHash(domain: string, version: number, payload: unknown): string {
  const bytes = new TextEncoder().encode(`${domain}:v${version}:${canonicalJson(payload)}`);
  return sha256(bytes);
}

export function getCanonicalAssetId(rawAsset: string): string {
  return rawAsset.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
