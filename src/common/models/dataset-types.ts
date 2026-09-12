import type { FeedContinuityEvent } from './feed-continuity.js';
import type { DecisionRecord, DecisionSignalLink, EntryResolutionRecord, ResultRecord, SignalRecord } from './journal-types.js';
import type { CaptureTransportSnapshot, TransportEventRecord } from './runtime-telemetry.js';
import type { Candle, OperationalDataState, PayoutSnapshot, Tick } from './types.js';

export interface DatasetAssetFeedHealth {
  canonicalAssetId: string;
  feedId: string;
  state: OperationalDataState;
  reason: string;
  assessedAt: number;
  latestTickReceivedAt: number | null;
  latestTickAgeMs: number | null;
}

export interface DatasetManifest {
  datasetSchemaVersion: '8';
  datasetId: string;
  createdAt: number;
  appVersion: string;
  buildId: string;
  sourceTreeSha256: string | null;
  gitCommit: string | null;
  gitWorkingTreeClean: boolean | null;
  gitProvenance: 'GIT' | 'ENVIRONMENT' | 'UNAVAILABLE';
  protocolRegistryVersion: string;
  protocolVerificationIds: string[];
  exportOperationalDataState: OperationalDataState;
  exportOperationalDataReason: string;
  latestTickAgeMsAtExport: number | null;
  assetFeedHealthAtExport: DatasetAssetFeedHealth[];
  captureTransportAtExport: CaptureTransportSnapshot;
  tickCount: number;
  decisionCount: number;
  rawCandidateDecisionCount: number;
  marketEpisodeCount: number;
  suppressedCorrelatedDecisionCount: number;
  signalCount: number;
  resultCount: number;
  continuityEventCount: number;
  transportEventCount: number;
  reconnectEventCount: number;
  configHashes: string[];
  checksumSha256: string;
}

export interface ScientificDataset {
  manifest: DatasetManifest;
  ticks: Tick[];
  payoutSnapshots: PayoutSnapshot[];
  candles: Candle[];
  decisions: DecisionRecord[];
  entryResolutions: EntryResolutionRecord[];
  decisionSignalLinks: DecisionSignalLink[];
  signals: SignalRecord[];
  results: ResultRecord[];
  continuityEvents: FeedContinuityEvent[];
  transportEvents: TransportEventRecord[];
}
