import { rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
rmSync('.test-dist', { recursive: true, force: true });
execFileSync('tsc', ['-p', 'tsconfig.test.json'], { stdio: 'inherit' });
writeFileSync('.test-dist/package.json', '{"type":"module"}');
