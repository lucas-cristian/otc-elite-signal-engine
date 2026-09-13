import { scientificCoreSha256 } from './scientific-core.mjs';

const BASELINE = 'ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db';
const actual = scientificCoreSha256();
if (actual !== BASELINE) {
  throw new Error(`Frozen scientific core changed: expected ${BASELINE}, got ${actual}`);
}
console.log(`Scientific core frozen (${actual.slice(0, 16)})`);
