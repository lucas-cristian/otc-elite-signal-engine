import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

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

function gitState() {
  try {
    const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { gitCommit, gitWorkingTreeClean: status.length === 0 };
  } catch {
    return { gitCommit: null, gitWorkingTreeClean: null };
  }
}

const sourceTreeSha256 = sourceTreeHash();
const git = gitState();
const buildMetadata = {
  appVersion,
  buildSystem: 'tsc',
  buildId: `source-${sourceTreeSha256.slice(0, 16)}`,
  sourceTreeSha256,
  gitCommit: git.gitWorkingTreeClean === true ? git.gitCommit : null,
  gitWorkingTreeClean: git.gitWorkingTreeClean,
};

rmSync('dist', { recursive: true, force: true });
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });
execFileSync('tsc', ['-p', 'tsconfig.content.json'], { stdio: 'inherit' });
mkdirSync('dist', { recursive: true });
cpSync('public/manifest.json', 'dist/manifest.json');
cpSync('src/ui/popup/index.html', 'dist/src/ui/popup/index.html');
cpSync('src/ui/dashboard/index.html', 'dist/src/ui/dashboard/index.html');
writeFileSync('dist/build-metadata.json', JSON.stringify(buildMetadata, null, 2));
