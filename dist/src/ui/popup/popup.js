const statusElement = document.querySelector('#status');
const productionButton = document.querySelector('#production');
const discoveryButton = document.querySelector('#discovery');
const dashboardButton = document.querySelector('#dashboard');
async function setMode(mode) {
    await chrome.storage.local.set({ protocolMode: mode });
    if (statusElement)
        statusElement.textContent = `${mode} selected. Reload the Pocket Option tab to apply.`;
}
productionButton?.addEventListener('click', () => void setMode('PRODUCTION'));
discoveryButton?.addEventListener('click', () => void setMode('PROTOCOL_DISCOVERY'));
dashboardButton?.addEventListener('click', () => void chrome.runtime.openOptionsPage());
void chrome.storage.local.get(['protocolMode']).then((settings) => {
    const mode = settings.protocolMode === 'PROTOCOL_DISCOVERY' ? 'PROTOCOL_DISCOVERY' : 'PRODUCTION';
    if (statusElement)
        statusElement.textContent = `Current mode: ${mode}`;
});
export {};
