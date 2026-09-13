interface PerformanceSliceResponse { key: string; resolved: number; correct: number; accuracy: number | null; }
interface AssetFeedHealthResponse { canonicalAssetId: string; feedId: string; state: string; reason: string; latestTickAgeMs: number | null; }
interface CaptureTransportResponse { connected: boolean; visibility: string; frozen: boolean | null; discarded: boolean | null; autoDiscardable: boolean | null; lastSemanticEventAt: number | null; lastLifecycleEventAt: number | null; lastLifecycleReason: string | null; shadowConnected: boolean; shadowPrimary: boolean; shadowState: string; shadowEndpointHost: string | null; shadowReconnectAttempts: number; shadowConsecutiveNamespaceRejects: number; shadowCircuitOpen: boolean; shadowLastMessageAt: number | null; shadowLastPriceAt: number | null; shadowLastErrorReason: string | null; shadowLastCommandAt: number | null; mitigation: string; }


interface Phase4PerformanceSliceResponse { key: string; resolved: number; correct: number; accuracy: number | null; }
interface Phase4StabilityBlockResponse { block: number; startOrdinal: number; endOrdinal: number; resolved: number; correct: number; accuracy: number | null; }
interface Phase4ExperimentResponse {
  experimentId: string;
  protocolVersion: string;
  frozen: true;
  baselineAppVersion: string;
  baselineStrategyGitCommit: string;
  scientificCoreSha256: string;
  validationAuthoritySha256: string;
  protocolSha256: string;
  createdByBuildGitCommit: string;
  configHash: string;
  prospectiveStartedAt: number;
  targetSampleSize: number;
  alpha: number;
  strictSettlementMaxDelayMs: number;
  stabilityPolicyId: string;
}
interface Phase4EvaluationResponse {
  finalStatus: 'PASS' | 'FAIL';
  correct: number;
  incorrect: number;
  accuracy: number;
  exactBinomialPValue: number;
  wilson99Low: number;
  wilson99High: number;
  stabilityGate: 'PASS' | 'FAIL';
  statisticalGate: 'PASS' | 'FAIL';
}
interface Phase4ReportResponse {
  experiment: Phase4ExperimentResponse | null;
  status: 'NOT_STARTED' | 'COLLECTING' | 'PASS' | 'FAIL' | 'INVALIDATED';
  prospectiveUniqueStrictEpisodes: number;
  targetSampleSize: number;
  remaining: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  wilson95Low: number | null;
  wilson95High: number | null;
  wilson99Low: number | null;
  wilson99High: number | null;
  exactBinomialPValue: number | null;
  confirmatoryEligible: boolean;
  confirmatoryEvaluation: Phase4EvaluationResponse | null;
  integrityGate: string;
  stabilityGate: string;
  stabilityBlocks: Phase4StabilityBlockResponse[];
  importedDatasetCount: number;
  duplicateEpisodeCount: number;
  exclusionsByReason: Record<string, number>;
  timeframePerformance: Phase4PerformanceSliceResponse[];
  directionPerformance: Phase4PerformanceSliceResponse[];
  structureRegimePerformance: Phase4PerformanceSliceResponse[];
  volatilityRegimePerformance: Phase4PerformanceSliceResponse[];
  contributingStrategyPerformance: Phase4PerformanceSliceResponse[];
  historicalInvalidatedExperiments: Array<{ experimentId: string; status: 'INVALIDATED'; acceptedEpisodes: number; correct: number; incorrect: number; accuracy: number | null; invalidationDetail: string }>;
  economicValidationStatus: 'UNAVAILABLE';
  economicValidationReason: string;
}

interface AnalyticsResponse {
  tickCount?: number;
  candleCount?: number;
  closedCandleCount?: number;
  decisionCount?: number;
  rawCandidateDecisionCount?: number;
  primaryEpisodeDecisionCount?: number;
  suppressedCorrelatedDecisionCount?: number;
  suppressedConflictDecisionCount?: number;
  marketEpisodeCount?: number;
  activeEpisodeCount?: number;
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
  independentEpisodeResolvedSampleSize?: number;
  strictSettlementMaxTimingErrorMs?: number;
  relaxedSettlementMaxTimingErrorMs?: number;
  strictResolvedDirectionalSampleSize?: number;
  strictDirectionalCorrectCount?: number;
  strictDirectionalAccuracy?: number | null;
  strictDirectionalWilsonLow?: number | null;
  strictDirectionalWilsonHigh?: number | null;
  relaxedResolvedDirectionalSampleSize?: number;
  relaxedDirectionalCorrectCount?: number;
  relaxedDirectionalAccuracy?: number | null;
  relaxedDirectionalWilsonLow?: number | null;
  relaxedDirectionalWilsonHigh?: number | null;
  strategyPerformance?: PerformanceSliceResponse[];
  timeframePerformance?: PerformanceSliceResponse[];
  strictStrategyPerformance?: PerformanceSliceResponse[];
  strictTimeframePerformance?: PerformanceSliceResponse[];
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
  latestArbitrationStatus?: string | null;
  assetFeedHealth?: AssetFeedHealthResponse[];
  healthyAssetFeedCount?: number;
  degradedAssetFeedCount?: number;
  staleAssetFeedCount?: number;
  unavailableAssetFeedCount?: number;
  captureTransport?: CaptureTransportResponse;
  buildId?: string;
  sourceTreeSha256?: string | null;
  scientificCoreSha256?: string | null;
  phase4ValidationAuthoritySha256?: string | null;
  phase4ProtocolSha256?: string | null;
  gitCommit?: string | null;
  gitWorkingTreeClean?: boolean | null;
  gitProvenance?: 'GIT' | 'ENVIRONMENT' | 'UNAVAILABLE';
  scientificBuildProvenanceReady?: boolean;
  phase4?: Phase4ReportResponse;
  error?: string;
}

const output = document.querySelector<HTMLElement>('#analytics');
const refresh = document.querySelector<HTMLButtonElement>('#refresh');
const exportButton = document.querySelector<HTMLButtonElement>('#export');
const startPhase4Button = document.querySelector<HTMLButtonElement>('#start-phase4');
const importPhase4Button = document.querySelector<HTMLButtonElement>('#import-phase4');
const exportPhase4Button = document.querySelector<HTMLButtonElement>('#export-phase4');
const phase4FileInput = document.querySelector<HTMLInputElement>('#phase4-file');
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

function pvalue(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return value < 0.000001 ? value.toExponential(3) : value.toFixed(6);
}

function phase4Performance(items: Phase4PerformanceSliceResponse[] | undefined): string {
  if (!items || items.length === 0) return 'N/A';
  return items.map((item) => `${item.key}: ${item.correct}/${item.resolved} (${percent(item.accuracy)})`).join(' | ');
}

function phase4Blocks(items: Phase4StabilityBlockResponse[] | undefined): string {
  if (!items || items.length === 0) return 'N/A';
  return items.map((item) => `B${item.block} ${item.correct}/${item.resolved} (${percent(item.accuracy)})`).join(' | ');
}

function phase4Exclusions(items: Record<string, number> | undefined): string {
  if (!items) return 'none';
  const entries = Object.entries(items).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? 'none' : entries.map(([reason, count]) => `${reason}=${count}`).join(' | ');
}


function performance(items: PerformanceSliceResponse[] | undefined): string {
  if (!items || items.length === 0) return 'N/A';
  return items.map((item) => `${item.key}: ${item.correct}/${item.resolved} (${percent(item.accuracy)})`).join(' | ');
}

function assetHealth(items: AssetFeedHealthResponse[] | undefined): string[] {
  if (!items || items.length === 0) return ['Tracked asset/feed health: N/A'];
  return items.map((item) => `${item.canonicalAssetId} @ ${item.feedId}: ${item.state} (${item.reason}, age ${age(item.latestTickAgeMs)})`);
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

    const intervalText = (low: number | null | undefined, high: number | null | undefined): string =>
      low === null || low === undefined || high === null || high === undefined
        ? 'N/A'
        : `${percent(low)} .. ${percent(high)}`;
    const relaxedWilson = intervalText(response.relaxedDirectionalWilsonLow ?? response.directionalWilsonLow, response.relaxedDirectionalWilsonHigh ?? response.directionalWilsonHigh);
    const strictWilson = intervalText(response.strictDirectionalWilsonLow, response.strictDirectionalWilsonHigh);
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
      'BUILD PROVENANCE',
      `Build ID: ${response.buildId ?? 'N/A'}`,
      `Source tree SHA-256: ${response.sourceTreeSha256 ?? 'N/A'}`,
      `Frozen scientific core SHA-256: ${response.scientificCoreSha256 ?? 'N/A'}`,
      `Phase 4 validation authority SHA-256: ${response.phase4ValidationAuthoritySha256 ?? 'N/A'}`,
      `Phase 4 protocol SHA-256: ${response.phase4ProtocolSha256 ?? 'N/A'}`,
      `Git provenance: ${response.gitProvenance ?? 'UNAVAILABLE'}`,
      `Git commit: ${response.gitCommit ?? 'N/A'}`,
      `Git working tree clean: ${response.gitWorkingTreeClean ?? 'N/A'}`,
      `Scientific export provenance ready: ${response.scientificBuildProvenanceReady ?? false}`,
      '',
      'CAPTURE RESILIENCE',
      `Transport connected: ${response.captureTransport?.connected ?? false}`,
      `Source tab visibility: ${response.captureTransport?.visibility ?? 'unknown'}`,
      `Source tab frozen: ${response.captureTransport?.frozen ?? 'unknown'}`,
      `Source tab discarded: ${response.captureTransport?.discarded ?? 'unknown'}`,
      `Source tab auto-discardable: ${response.captureTransport?.autoDiscardable ?? 'unknown'}`,
      `Last semantic transport event: ${timestamp(response.captureTransport?.lastSemanticEventAt)}`,
      `Last lifecycle event: ${timestamp(response.captureTransport?.lastLifecycleEventAt)}`,
      `Last lifecycle reason: ${response.captureTransport?.lastLifecycleReason ?? 'N/A'}`,
      `Shadow market socket: ${response.captureTransport?.shadowConnected ?? false}`,
      `Shadow primary feed: ${response.captureTransport?.shadowPrimary ?? false}`,
      `Shadow state: ${response.captureTransport?.shadowState ?? 'WAITING_CONTEXT'}`,
      `Shadow endpoint: ${response.captureTransport?.shadowEndpointHost ?? 'N/A'}`,
      `Shadow reconnect attempts: ${response.captureTransport?.shadowReconnectAttempts ?? 0}`,
      `Shadow namespace rejects: ${response.captureTransport?.shadowConsecutiveNamespaceRejects ?? 0}`,
      `Shadow circuit open: ${response.captureTransport?.shadowCircuitOpen ?? false}`,
      `Shadow last message: ${timestamp(response.captureTransport?.shadowLastMessageAt)}`,
      `Shadow last price: ${timestamp(response.captureTransport?.shadowLastPriceAt)}`,
      `Shadow last error: ${response.captureTransport?.shadowLastErrorReason ?? 'none'}`,
      `Shadow last supervisor command: ${timestamp(response.captureTransport?.shadowLastCommandAt)}`,
      `Transport mitigation: ${response.captureTransport?.mitigation ?? 'N/A'}`,
      '',
      'LIVE DATA HEALTH WATCHDOG',
      `Current operational state: ${response.currentOperationalDataState ?? 'N/A'}`,
      `Reason: ${response.currentOperationalDataReason ?? 'N/A'}`,
      `Watchdog assessed: ${timestamp(response.watchdogAssessedAt)}`,
      `Degraded after: ${age(response.healthDegradedAfterMs)}`,
      `Stale after: ${age(response.healthStaleAfterMs)}`,
      `Data unavailable after: ${age(response.healthDataUnavailableAfterMs)}`,
      `Asset/feed states: HEALTHY ${response.healthyAssetFeedCount ?? 0}, DEGRADED ${response.degradedAssetFeedCount ?? 0}, STALE ${response.staleAssetFeedCount ?? 0}, DATA_UNAVAILABLE ${response.unavailableAssetFeedCount ?? 0}`,
      ...assetHealth(response.assetFeedHealth),
      '',
      'DECISION PIPELINE',
      `Decisions: ${response.decisionCount ?? 0}`,
      `Raw eligible candidate decisions: ${response.rawCandidateDecisionCount ?? 0}`,
      `Independent market episodes: ${response.marketEpisodeCount ?? 0}`,
      `Active market episodes: ${response.activeEpisodeCount ?? 0}`,
      `Primary episode decisions: ${response.primaryEpisodeDecisionCount ?? 0}`,
      `Suppressed correlated decisions: ${response.suppressedCorrelatedDecisionCount ?? 0}`,
      `Suppressed arbitration conflicts: ${response.suppressedConflictDecisionCount ?? 0}`,
      `CALL/PUT decisions after arbitration: ${response.callPutDecisionCount ?? 0}`,
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
      `Latest arbitration: ${response.latestArbitrationStatus ?? 'N/A'}`,
      `Latest blockers: ${blockers}`,
      '',
      'REFERENCE DIRECTIONAL EVALUATION',
      `STRICT settlement window: <= ${response.strictSettlementMaxTimingErrorMs ?? 1000} ms`,
      `Strict resolved episode sample: ${response.strictResolvedDirectionalSampleSize ?? 0}`,
      `Strict correct: ${response.strictDirectionalCorrectCount ?? 0}`,
      `Strict directional accuracy: ${percent(response.strictDirectionalAccuracy)}`,
      `Strict Wilson 95% interval: ${strictWilson}`,
      `Strict by timeframe: ${performance(response.strictTimeframePerformance)}`,
      `Strict by contributing strategy: ${performance(response.strictStrategyPerformance)}`,
      '',
      `RELAXED settlement window: <= ${response.relaxedSettlementMaxTimingErrorMs ?? 5000} ms`,
      `Relaxed resolved episode sample: ${response.relaxedResolvedDirectionalSampleSize ?? response.independentEpisodeResolvedSampleSize ?? response.resolvedDirectionalSampleSize ?? 0}`,
      `Relaxed correct: ${response.relaxedDirectionalCorrectCount ?? 0}`,
      `Relaxed directional accuracy: ${percent(response.relaxedDirectionalAccuracy ?? response.directionalAccuracy)}`,
      `Relaxed Wilson 95% interval: ${relaxedWilson}`,
      `Relaxed by timeframe: ${performance(response.timeframePerformance)}`,
      `Relaxed by contributing strategy: ${performance(response.strategyPerformance)}`,
      '',
      'PHASE 4 — PROSPECTIVE STATISTICAL VALIDATION',
      `Experiment: ${response.phase4?.experiment?.experimentId ?? 'NOT_STARTED'}`,
      `Protocol status: ${response.phase4?.experiment?.frozen ? 'FROZEN' : 'NOT_STARTED'}`,
      `Derived status: ${response.phase4?.status ?? 'NOT_STARTED'}`,
      `Strategy baseline: ${response.phase4?.experiment?.baselineAppVersion ?? 'N/A'} @ ${response.phase4?.experiment?.baselineStrategyGitCommit ?? 'N/A'}`,
      `Scientific core: ${response.phase4?.experiment?.scientificCoreSha256 ?? 'N/A'}`,
      `Validation authority: ${response.phase4?.experiment?.validationAuthoritySha256 ?? 'N/A'}`,
      `Protocol SHA-256: ${response.phase4?.experiment?.protocolSha256 ?? 'N/A'}`,
      `Config hash: ${response.phase4?.experiment?.configHash ?? 'N/A'}`,
      `Prospective start: ${timestamp(response.phase4?.experiment?.prospectiveStartedAt)}`,
      `Primary endpoint: STRICT directional accuracy <= ${response.phase4?.experiment?.strictSettlementMaxDelayMs ?? 1000} ms`,
      `Prospective STRICT unique episodes: ${response.phase4?.prospectiveUniqueStrictEpisodes ?? 0}/${response.phase4?.targetSampleSize ?? 500}`,
      `Remaining: ${response.phase4?.remaining ?? 500}`,
      `Correct / incorrect: ${response.phase4?.correct ?? 0} / ${response.phase4?.incorrect ?? 0}`,
      `Current accuracy: ${percent(response.phase4?.accuracy)}`,
      `Wilson 95%: ${intervalText(response.phase4?.wilson95Low, response.phase4?.wilson95High)}`,
      `Wilson 99%: ${intervalText(response.phase4?.wilson99Low, response.phase4?.wilson99High)}`,
      `Exact one-sided binomial p-value: ${pvalue(response.phase4?.exactBinomialPValue)}`,
      `Confirmatory eligible: ${response.phase4?.confirmatoryEligible ?? false}`,
      `Integrity gate: ${response.phase4?.integrityGate ?? 'PENDING'}`,
      `Stability gate: ${response.phase4?.stabilityGate ?? 'PENDING'}`,
      `Stability blocks: ${phase4Blocks(response.phase4?.stabilityBlocks)}`,
      `Imported datasets: ${response.phase4?.importedDatasetCount ?? 0}`,
      `Duplicate episodes ignored: ${response.phase4?.duplicateEpisodeCount ?? 0}`,
      `Exclusions: ${phase4Exclusions(response.phase4?.exclusionsByReason)}`,
      `By timeframe (secondary): ${phase4Performance(response.phase4?.timeframePerformance)}`,
      `By direction (secondary): ${phase4Performance(response.phase4?.directionPerformance)}`,
      `By structure regime (secondary): ${phase4Performance(response.phase4?.structureRegimePerformance)}`,
      `By volatility regime (secondary): ${phase4Performance(response.phase4?.volatilityRegimePerformance)}`,
      `By contributing strategy (exploratory, overlapping): ${phase4Performance(response.phase4?.contributingStrategyPerformance)}`,
      `Historical invalidated experiments: ${(response.phase4?.historicalInvalidatedExperiments ?? []).map((item) => `${item.experimentId} ${item.correct}/${item.acceptedEpisodes} (${percent(item.accuracy)}) ${item.invalidationDetail}`).join(' | ') || 'none'}`,
      `Economic validation: ${response.phase4?.economicValidationStatus ?? 'UNAVAILABLE'} (${response.phase4?.economicValidationReason ?? 'PAYOUT_EXPIRATION_UNBOUND'})`,
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


async function startPhase4(): Promise<void> {
  if (!confirm('Start and irreversibly freeze Phase 4 prospective validation from this moment? Pre-existing results will not count toward the confirmatory sample.')) return;
  const response = await chrome.runtime.sendMessage({ type: 'START_PHASE4' }) as { error?: string };
  if (response.error && output) output.textContent = response.error;
  await load();
}

async function importPhase4Dataset(file: File): Promise<void> {
  const json = await file.text();
  const response = await chrome.runtime.sendMessage({ type: 'IMPORT_PHASE4_DATASET_JSON', json }) as { error?: string };
  if (response.error && output) output.textContent = response.error;
  await load();
}

async function exportPhase4Report(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'EXPORT_PHASE4_REPORT_JSON' }) as { filename?: string; json?: string; error?: string };
  if (!response.filename || !response.json) {
    if (output) output.textContent = response.error ?? 'Phase 4 report export failed';
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
startPhase4Button?.addEventListener('click', () => void startPhase4());
importPhase4Button?.addEventListener('click', () => phase4FileInput?.click());
phase4FileInput?.addEventListener('change', () => {
  const file = phase4FileInput.files?.[0];
  if (file) void importPhase4Dataset(file);
  phase4FileInput.value = '';
});
exportPhase4Button?.addEventListener('click', () => void exportPhase4Report());
window.setInterval(() => void load(), 2_000);
void load();

export {};
