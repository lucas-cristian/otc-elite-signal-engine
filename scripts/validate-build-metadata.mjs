import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const metadata = JSON.parse(readFileSync('dist/build-metadata.json', 'utf8'));
if (typeof metadata.appVersion !== 'string' || typeof metadata.buildId !== 'string') throw new Error('build metadata identity missing');
if (typeof metadata.sourceTreeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.sourceTreeSha256)) throw new Error('invalid sourceTreeSha256');
if (typeof metadata.scientificCoreSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.scientificCoreSha256)) throw new Error('invalid scientificCoreSha256');
if (typeof metadata.phase4ValidationAuthoritySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.phase4ValidationAuthoritySha256)) throw new Error('invalid phase4ValidationAuthoritySha256');
if (typeof metadata.phase4ProtocolSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.phase4ProtocolSha256)) throw new Error('invalid phase4ProtocolSha256');
if (!['GIT', 'ENVIRONMENT', 'UNAVAILABLE'].includes(metadata.gitProvenance)) throw new Error('invalid gitProvenance');

const candidates = [...new Set([process.env.INIT_CWD, process.env.PWD, process.cwd()]
  .filter((value) => typeof value === 'string' && value.length > 0)
  .map((value) => path.resolve(value)))];
let head = null;
for (const directory of candidates) {
  try {
    const root = execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    break;
  } catch {}
}

if (head !== null) {
  if (metadata.gitProvenance !== 'GIT') throw new Error('git checkout detected but build metadata provenance is not GIT');
  if (metadata.gitCommit !== head) throw new Error(`build metadata gitCommit ${metadata.gitCommit ?? 'null'} does not match HEAD ${head}`);
}

console.log(`Build metadata valid (${metadata.gitProvenance}${metadata.gitCommit ? ` ${metadata.gitCommit.slice(0, 12)}` : ''})`);
