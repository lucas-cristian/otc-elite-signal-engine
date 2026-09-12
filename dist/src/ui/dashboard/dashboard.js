const output = document.querySelector('#analytics');
const refresh = document.querySelector('#refresh');
const exportButton = document.querySelector('#export');
function percent(value) {
    return value === null || value === undefined ? 'N/A' : `${(value * 100).toFixed(2)}%`;
}
async function load() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ANALYTICS' });
    if (!output)
        return;
    if (response.error) {
        output.textContent = response.error;
        return;
    }
    output.textContent = [
        `Decisions: ${response.decisionCount ?? 0}`,
        `CALL/PUT decisions: ${response.callPutDecisionCount ?? 0}`,
        `Entry resolved: ${response.entryResolvedCount ?? 0}`,
        `Entry unresolved: ${response.entryUnresolvedCount ?? 0}`,
        `Reference directional sample: ${response.resolvedDirectionalSampleSize ?? 0}`,
        `Reference directional accuracy: ${percent(response.directionalAccuracy)}`,
        `Economic sample: ${response.economicSampleSize ?? 0}`,
        `Economic coverage: ${percent(response.economicCoverageRate)}`,
        `Observed mean reference return: ${response.observedMeanReferenceReturn ?? 'N/A'}`,
        `Economic evidence: ${response.economicEvidenceStatus ?? 'INSUFFICIENT_DATA'}`,
    ].join('\n');
}
async function exportDataset() {
    const response = await chrome.runtime.sendMessage({ type: 'EXPORT_DATASET_JSON' });
    if (!response.filename || !response.json) {
        if (output)
            output.textContent = response.error ?? 'Export failed';
        return;
    }
    const url = URL.createObjectURL(new Blob([response.json], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = response.filename;
    anchor.click();
    URL.revokeObjectURL(url);
}
refresh?.addEventListener('click', () => void load());
exportButton?.addEventListener('click', () => void exportDataset());
void load();
export {};
