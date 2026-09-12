import { readFileSync, existsSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const required = [manifest.background?.service_worker, ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []), manifest.action?.default_popup, manifest.options_ui?.page];
if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
if (!Array.isArray(manifest.host_permissions) || !manifest.host_permissions.every((p) => p.includes('pocketoption.com'))) throw new Error('host_permissions must be Pocket Option only');
for (const path of required) if (typeof path !== 'string' || !existsSync(`dist/${path}`)) throw new Error(`Missing manifest artifact: ${String(path)}`);
console.log('manifest valid');
