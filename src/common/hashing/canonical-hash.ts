import { sha256 } from 'js-sha256';

export const canonicalHashVersion = 1;

/**
 * Serializa um payload em JSON canônico (chaves ordenadas recursivamente).
 */
export function canonicalJson(payload: unknown): string {
  if (payload === null) return 'null';
  if (typeof payload === 'number') {
    if (isNaN(payload) || !isFinite(payload)) {
      throw new Error('NaN and Infinity are not allowed in canonical hashing');
    }
    // Handle -0
    if (payload === 0 && 1 / payload === -Infinity) {
      return '0';
    }
    return payload.toString();
  }
  if (typeof payload === 'boolean' || typeof payload === 'string') {
    return JSON.stringify(payload);
  }
  if (typeof payload === 'undefined') {
    throw new Error('undefined is not allowed in canonical hashing');
  }
  if (payload instanceof Date) {
    throw new Error('Date objects are not allowed in canonical hashing. Use epoch ms.');
  }
  if (Array.isArray(payload)) {
    return '[' + payload.map(item => canonicalJson(item)).join(',') + ']';
  }
  if (typeof payload === 'object') {
    const keys = Object.keys(payload).sort();
    let out = '{';
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = (payload as Record<string, unknown>)[k];
      if (v === undefined) {
        throw new Error(`undefined is not allowed in canonical hashing (key: ${k})`);
      }
      out += JSON.stringify(k) + ':' + canonicalJson(v);
      if (i < keys.length - 1) {
        out += ',';
      }
    }
    out += '}';
    return out;
  }
  throw new Error(`Unsupported type for canonical json: ${typeof payload}`);
}

/**
 * Codifica uma string em UTF-8 Uint8Array.
 */
function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Concatena dois Uint8Arrays.
 */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

/**
 * Gera um SHA-256 canônico com separação de domínio.
 */
export function canonicalEntityHash(domain: string, version: number, payload: unknown): string {
  const prefixBytes = utf8Encode(`${domain}:v${version}:`);
  const payloadBytes = utf8Encode(canonicalJson(payload));
  const combined = concatBytes(prefixBytes, payloadBytes);
  return sha256.hex(combined);
}

/**
 * Padroniza o identificador do ativo para comparações e identidades.
 */
export function getCanonicalAssetId(rawAsset: string): string {
  return rawAsset.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
