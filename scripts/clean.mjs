import { rmSync } from 'node:fs';
for (const path of ['dist', '.test-dist']) rmSync(path, { recursive: true, force: true });
