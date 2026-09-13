import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const FIXED_CORE_FILES = [
  'src/common/hashing/canonical-hash.ts',
  'src/common/hashing/sha256.ts',
  'src/common/models/feed-continuity.ts',
  'src/common/models/journal-types.ts',
  'src/common/models/market-source-identity.ts',
  'src/common/models/types.ts',
  'src/common/protocol/market-events.ts',
  'src/common/protocol/pocket-option-parser.ts',
  'src/common/protocol/protocol-verification-registry.ts',
  'src/common/protocol/shadow-market-policy.ts',
  'src/common/time/candle-time.ts',
  'src/common/time/clock.ts',
  'src/common/validation/semantic-event-validator.ts',
  'src/common/validation/tick-factory.ts',
  'src/service-worker/core/data-health.ts',
  'src/service-worker/core/market-episode-arbitrator.ts',
  'src/service-worker/core/quant-pipeline.ts',
  'src/service-worker/evaluation/result-engine.ts',
  'src/service-worker/storage/recovery-service.ts',
];

function walkTs(directory) {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walkTs(full));
    else if (stat.isFile() && full.endsWith('.ts')) files.push(full.replaceAll(path.sep, '/'));
  }
  return files;
}

export function scientificCoreFiles() {
  return [...new Set([...FIXED_CORE_FILES, ...walkTs('src/service-worker/engine')])].sort();
}

export function scientificCoreSha256() {
  const hash = createHash('sha256');
  for (const file of scientificCoreFiles()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
