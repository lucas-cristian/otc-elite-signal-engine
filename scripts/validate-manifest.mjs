import { existsSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const required = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  manifest.action?.default_popup,
  manifest.options_ui?.page,
];

if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
if (manifest.version !== packageJson.version) throw new Error('manifest version must match package version');
if (!Array.isArray(manifest.host_permissions) || !manifest.host_permissions.every((permission) => permission.includes('pocketoption.com'))) {
  throw new Error('host_permissions must be Pocket Option only');
}
if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('alarms')) throw new Error('alarms permission is required for MV3 data-health watchdog');

const contentBundle = readFileSync('dist/content.js', 'utf8');
if (contentBundle.includes('setTimeout(')) throw new Error('production content transport must not depend on setTimeout');
if (!contentBundle.includes('runtime.connect')) throw new Error('production content transport must use runtime.Port');
const backgroundBundle = readFileSync('dist/src/service-worker/core/background.js', 'utf8');
if (!backgroundBundle.includes('autoDiscardable')) throw new Error('source-tab auto-discard mitigation missing');

const resources = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? []);
if (!resources.includes('src/common/protocol/protocol-verification-registry.js')) throw new Error('protocol verification registry must be web-accessible to MAIN world parser');
for (const artifactPath of required) {
  if (typeof artifactPath !== 'string' || !existsSync(`dist/${artifactPath}`)) throw new Error(`Missing manifest artifact: ${String(artifactPath)}`);
}
console.log('manifest valid');
