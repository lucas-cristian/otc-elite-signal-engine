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
if (!Array.isArray(manifest.host_permissions)) throw new Error('host_permissions missing');
const allowedHostPermission = (permission) => permission.includes('pocketoption.com') || permission.includes('po.market');
if (!manifest.host_permissions.every(allowedHostPermission)) throw new Error('host_permissions must be limited to Pocket Option properties');
if (manifest.host_permissions.some((permission) => permission.startsWith('ws://') || permission.startsWith('wss://'))) throw new Error('WebSocket schemes are not valid MV3 host match patterns; use CSP connect-src instead');
if (Number.parseInt(manifest.minimum_chrome_version ?? '0', 10) < 116) throw new Error('minimum_chrome_version must be at least 116 for resilient service-worker WebSockets');
if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('alarms')) throw new Error('alarms permission is required for MV3 data-health watchdog');

const contentBundle = readFileSync('dist/content.js', 'utf8');
if (contentBundle.includes('setTimeout(')) throw new Error('production content transport must not depend on setTimeout');
if (!contentBundle.includes('runtime.connect')) throw new Error('production content transport must use runtime.Port');
if (contentBundle.includes('AUTH_PACKET') || contentBundle.includes('SHADOW_RECOVERY_CONTEXT')) throw new Error('auth/recovery secrets must not cross into isolated world');
if (!contentBundle.includes('SHADOW_CONTROL')) throw new Error('content script must forward shadow supervisor commands to MAIN world');
const backgroundBundle = readFileSync('dist/src/service-worker/core/background.js', 'utf8');
if (!backgroundBundle.includes('autoDiscardable')) throw new Error('source-tab auto-discard mitigation missing');
if (backgroundBundle.includes('ShadowMarketConnection')) throw new Error('service worker must not own authenticated shadow WebSocket');
if (!backgroundBundle.includes('FORCE_RECONNECT')) throw new Error('service worker shadow supervisor missing');

const resources = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? []);
if (!resources.includes('src/common/protocol/protocol-verification-registry.js')) throw new Error('protocol verification registry must be web-accessible to MAIN world parser');
if (!resources.includes('src/common/protocol/shadow-market-policy.js')) throw new Error('shadow market policy must be web-accessible to MAIN world');
for (const artifactPath of required) {
  if (typeof artifactPath !== 'string' || !existsSync(`dist/${artifactPath}`)) throw new Error(`Missing manifest artifact: ${String(artifactPath)}`);
}
console.log('manifest valid');
