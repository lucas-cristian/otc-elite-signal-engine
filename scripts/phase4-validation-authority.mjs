import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const AUTHORITY_FILES = [
  'src/scientific-validation/phase4/engine.ts',
  'src/scientific-validation/phase4/indexeddb-repository.ts',
  'src/scientific-validation/phase4/replay.ts',
  'src/scientific-validation/phase4/repository.ts',
  'src/scientific-validation/phase4/types.ts',
  'src/scientific-validation/statistics/exact-binomial.ts',
  'src/scientific-validation/statistics/temporal-robustness.ts',
  'src/scientific-validation/statistics/wilson-interval.ts',
].sort();

export function phase4ValidationAuthorityFiles() {
  return [...AUTHORITY_FILES];
}

export function phase4ValidationAuthoritySha256() {
  const hash = createHash('sha256');
  for (const file of AUTHORITY_FILES) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
