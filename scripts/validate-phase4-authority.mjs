import { readFileSync } from 'node:fs';
import { phase4ValidationAuthoritySha256 } from './phase4-validation-authority.mjs';
import { phase4ProtocolSha256 } from './phase4-protocol.mjs';

const lock = JSON.parse(readFileSync('phase4-authority-lock.json', 'utf8'));
const authority = phase4ValidationAuthoritySha256();
const protocol = phase4ProtocolSha256();
if (lock.validationAuthoritySha256 !== authority) {
  throw new Error(`Frozen Phase 4 validation authority changed: expected ${lock.validationAuthoritySha256}, got ${authority}`);
}
if (lock.protocolSha256 !== protocol) {
  throw new Error(`Frozen Phase 4 protocol changed: expected ${lock.protocolSha256}, got ${protocol}`);
}
console.log(`Phase 4 authority frozen (${authority.slice(0, 16)}; protocol ${protocol.slice(0, 16)})`);
