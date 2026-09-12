interface AnalyticsResponse {
  tickCount?: number;
  candleCount?: number;
  closedCandleCount?: number;
  decisionCount?: number;
  callPutDecisionCount?: number;
  entryResolvedCount?: number;
  entryUnresolvedCount?: number;
  pendingEntryCount?: number;
  signalCount?: number;
  pendingSignalCount?: number;
  resolvedResultCount?: number;
  unresolvedResultCount?: number;
  resolvedDirectionalSampleSize?: number;
  directionalAccuracy?: number | null;
  directionalWilsonLow?: number | null;
  directionalWilsonHigh?: number | null;
  economicSampleSize?: number;
  economicIneligibleResolvedCount?: number;
  economicCoverageRate?: number | null;
  observedMeanReferenceReturn?: number | null;
  economicEvidenceStatus?: string;
  currentAssetId?: string | null;
  currentInstrumentId?: string | null;
  currentFeedId?: string | null;
  latestPrice?: number | null;
  latestTickReceivedAt?: number | null;
  latestTickAgeMs?: number | null;
  latestSourceQuality?: string | null;
  latestProtocolVerificationId?: string | null;
  protocolRegistryVersion?: string;
  latestTickIntegrity?: string | null;
  latestPayoutRate?: number | null;
  latestPayoutExpirationSeconds?: number | null;
  latestPayoutExpirationBinding?: string | null;
  latestPayoutQuality?: string | null;
  latestPayoutProtocolVerificationId?: string | null;
  latestPayoutCapturedAt?: number | null;
  latestDecision?: string | null;
  latestDecisionTimeframe?: string | null;
  latestStructureRegime?: string | null;
  latestVolatilityRegime?: string | null;
  latestDecisionOperationalDataState?: string | null;
  currentOperationalDataState?: string;
  currentOperationalDataReason?: string;
  watchdogAssessedAt?: number;
  healthDegradedAfterMs?: number;
  healthStaleAfterMs?: number;
  healthDataUnavailableAfterMs?: number;
  latestModelScore?: number | null;
  latestBlockers?: string[];
  error?: string;
}

const output = document.querySelector<HTMLElement>('#analytics');
const refresh = document.querySelector<HTMLButtonElement>('#refresh');
const exportButton = document.querySelector<HTMLButtonElement>('#export');
let loading = false;

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? 'N/A' : `${(value * 100).toFixed(2)}%`;
}

function number(value: number | null | undefined, decimals = 6): string {
  return value === null || value === undefined ? 'N/A' : value.toFixed(decimals);
}

function timestamp(value: number | null | undefined): string {
  return value === null || value === undefined ? 'N/A' : new Date(value).toISOString();
}

function age(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

function payout(value: number | null | undefined): string {
  return value === null || value === undefined ? 'UNKNOWN' : percent(value);
}

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ANALYTICS' }) as AnalyticsResponse;
    if (!output) return;
    if (response.error) {
      output.textContent = response.error;
      return;
    }

    const wilson = response.directionalWilsonLow === null || response.directionalWilsonLow === undefined
      || response.directionalWilsonHigh === null || response.directionalWilsonHigh === undefined
      ? 'N/A'
      : `${percent(response.directionalWilsonLow)} .. ${percent(response.directionalWilsonHigh)}`;
    const blockers = response.latestBlockers?.length ? response.latestBlockers.join(', ') : 'none';
    const payoutExpiration = response.latestPayoutExpirationSeconds === null || response.latestPayoutExpirationSeconds === undefined
      ? 'UNKNOWN (not bound by observed chafor schema)'
      : `${response.latestPayoutExpirationSeconds}s`;

    output.textContent = [
      'LIVE MARKET TELEMETRY',
      `Ticks: ${response.tickCount ?? 0}`,
      `Candles: ${response.candleCount ?? 0} (${response.closedCandleCount ?? 0} closed)`,
      `Current instrument: ${response.currentInstrumentId ?? 'N/A'}`,
      `Canonical asset: ${response.currentAssetId ?? 'N/A'}`,
      `Feed: ${response.currentFeedId ?? 'N/A'}`,
      `Latest price: ${number(response.latestPrice)}`,
      `Latest tick received: ${timestamp(response.latestTickReceivedAt)}`,
      `Latest tick age: ${age(response.latestTickAgeMs)}`,
      `Source quality: ${response.latestSourceQuality ?? 'N/A'}`,
      `Protocol verification: ${response.latestProtocolVerificationId ?? 'UNVERIFIED'}`,
      `Protocol registry: ${response.protocolRegistryVersion ?? 'N/A'}`,
      `Tick integrity: ${response.latestTickIntegrity ?? 'N/A'}`,
      '',
      'LIVE DATA HEALTH WATCHDOG',
      `Current operational state: ${response.currentOperationalDataState ?? 'N/A'}`,
      `Reason: ${response.currentOperationalDataReason ?? 'N/A'}`,
      `Watchdog assessed: ${timestamp(response.watchdogAssessedAt)}`,
      `Degraded after: ${age(response.healthDegradedAfterMs)}`,
      `Stale after: ${age(response.healthStaleAfterMs)}`,
      `Data unavailable after: ${age(response.healthDataUnavailableAfterMs)}`,
      '',
      'DECISION PIPELINE',
      `Decisions: ${response.decisionCount ?? 0}`,
      `CALL/PUT decisions: ${response.callPutDecisionCount ?? 0}`,
      `Entry resolved: ${response.entryResolvedCount ?? 0}`,
      `Entry unresolved: ${response.entryUnresolvedCount ?? 0}`,
      `Entry pending: ${response.pendingEntryCount ?? 0}`,
      `Signals: ${response.signalCount ?? 0}`,
      `Results resolved: ${response.resolvedResultCount ?? 0}`,
      `Results unresolved: ${response.unresolvedResultCount ?? 0}`,
      `Results pending: ${response.pendingSignalCount ?? 0}`,
      `Latest decision: ${response.latestDecision ?? 'N/A'} @ ${response.latestDecisionTimeframe ?? 'N/A'}`,
      `Latest model score: ${number(response.latestModelScore, 4)}`,
      `Structure regime: ${response.latestStructureRegime ?? 'N/A'}`,
      `Volatility regime: ${response.latestVolatilityRegime ?? 'N/A'}`,
      `Decision-time data state: ${response.latestDecisionOperationalDataState ?? 'N/A'}`,
      `Latest blockers: ${blockers}`,
      '',
      'REFERENCE DIRECTIONAL EVALUATION',
      `Resolved directional sample: ${response.resolvedDirectionalSampleSize ?? 0}`,
      `Directional accuracy: ${percent(response.directionalAccuracy)}`,
      `Wilson 95% interval: ${wilson}`,
      '',
      'ECONOMIC EVALUATION (FAIL-CLOSED)',
      `Latest payout: ${payout(response.latestPayoutRate)}`,
      `Payout expiration: ${payoutExpiration}`,
      `Payout expiration binding: ${response.latestPayoutExpirationBinding ?? 'N/A'}`,
      `Payout quality: ${response.latestPayoutQuality ?? 'N/A'}`,
      `Payout verification: ${response.latestPayoutProtocolVerificationId ?? 'UNVERIFIED'}`,
      `Payout captured: ${timestamp(response.latestPayoutCapturedAt)}`,
      `Economic eligible sample: ${response.economicSampleSize ?? 0}`,
      `Economic ineligible resolved: ${response.economicIneligibleResolvedCount ?? 0}`,
      `Economic coverage: ${percent(response.economicCoverageRate)}`,
      `Observed mean reference return: ${number(response.observedMeanReferenceReturn, 6)}`,
      `Economic evidence: ${response.economicEvidenceStatus ?? 'INSUFFICIENT_DATA'}`,
      'Economic return remains unavailable unless payout is VERIFIED and explicitly bound to the signal expiration.',
    ].join('\n');
  } finally {
    loading = false;
  }
}

async function exportDataset(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'EXPORT_DATASET_JSON' }) as { filename?: string; json?: string; error?: string };
  if (!response.filename || !response.json) {
    if (output) output.textContent = response.error ?? 'Export failed';
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
window.setInterval(() => void load(), 2_000);
void load();

export {};
