import { sha256 } from './sha256.js';
function normalize(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new TypeError('Non-finite numbers are not canonical');
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value))
        return value.map(normalize);
    if (typeof value === 'object') {
        const result = {};
        for (const key of Object.keys(value).sort()) {
            const member = value[key];
            if (member === undefined)
                throw new TypeError('undefined is not canonical');
            result[key] = normalize(member);
        }
        return result;
    }
    throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}
export function canonicalJson(value) {
    return JSON.stringify(normalize(value));
}
export function canonicalEntityHash(domain, version, payload) {
    const bytes = new TextEncoder().encode(`${domain}:v${version}:${canonicalJson(payload)}`);
    return sha256(bytes);
}
export function getCanonicalAssetId(rawAsset) {
    return rawAsset.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
