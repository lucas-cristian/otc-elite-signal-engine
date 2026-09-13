import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { scientificCoreSha256 } from './scientific-core.mjs';
import { phase4ValidationAuthoritySha256 } from './phase4-validation-authority.mjs';
import { phase4ProtocolSha256 } from './phase4-protocol.mjs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const appVersion = String(packageJson.version);

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else if (stat.isFile()) files.push(full);
  }
  return files;
}

function sourceTreeHash() {
  const roots = ['src', 'public', 'scripts'];
  const fixed = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.content.json', 'tsconfig.test.json'];
  const files = [...roots.flatMap(walk), ...fixed].filter((file) => statSync(file).isFile()).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function gitCandidates() {
  return [...new Set([
    process.env.INIT_CWD,
    process.env.PWD,
    process.cwd(),
  ].filter((value) => typeof value === 'string' && value.length > 0).map((value) => path.resolve(value)))];
}

function gitStateFrom(directory) {
  const gitRoot = execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const gitCommit = execFileSync('git', ['-C', gitRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const status = execFileSync('git', ['-C', gitRoot, 'status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return { gitCommit, gitWorkingTreeClean: status.length === 0, gitProvenance: 'GIT' };
}

function gitState() {
  for (const directory of gitCandidates()) {
    try {
      return gitStateFrom(directory);
    } catch {}
  }
  const environmentCommit = process.env.OTC_GIT_COMMIT || process.env.GITHUB_SHA || null;
  return {
    gitCommit: environmentCommit,
    gitWorkingTreeClean: null,
    gitProvenance: environmentCommit === null ? 'UNAVAILABLE' : 'ENVIRONMENT',
  };
}

const sourceTreeSha256 = sourceTreeHash();
const frozenScientificCoreSha256 = scientificCoreSha256();
const frozenPhase4ValidationAuthoritySha256 = phase4ValidationAuthoritySha256();
const frozenPhase4ProtocolSha256 = phase4ProtocolSha256();
const git = gitState();
const buildMetadata = {
  appVersion,
  buildSystem: 'tsc',
  buildId: `source-${sourceTreeSha256.slice(0, 16)}`,
  sourceTreeSha256,
  scientificCoreSha256: frozenScientificCoreSha256,
  phase4ValidationAuthoritySha256: frozenPhase4ValidationAuthoritySha256,
  phase4ProtocolSha256: frozenPhase4ProtocolSha256,
  gitCommit: git.gitCommit,
  gitWorkingTreeClean: git.gitWorkingTreeClean,
  gitProvenance: git.gitProvenance,
};

rmSync('dist', { recursive: true, force: true });
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });
execFileSync('tsc', ['-p', 'tsconfig.content.json'], { stdio: 'inherit' });
copyFileSync('dist/content-build/isolated-world/content-script.js', 'dist/content.js');
rmSync('dist/content-build', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public/manifest.json', 'dist/manifest.json');
cpSync('src/ui/popup/index.html', 'dist/src/ui/popup/index.html');
cpSync('src/ui/dashboard/index.html', 'dist/src/ui/dashboard/index.html');
writeFileSync('dist/build-metadata.json', JSON.stringify(buildMetadata, null, 2));
