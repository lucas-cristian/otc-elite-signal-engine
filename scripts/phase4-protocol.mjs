import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PHASE4_PROTOCOL_FILE = 'phase4_protocol_v4.md';

export function phase4ProtocolSha256() {
  return createHash('sha256').update(readFileSync(PHASE4_PROTOCOL_FILE)).digest('hex');
}
