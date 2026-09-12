import type { Candle, PayoutSnapshot, Tick } from './types.js';
import type { DecisionRecord, DecisionSignalLink, EntryResolutionRecord, ResultRecord, SignalRecord } from './journal-types.js';

export interface DatasetManifest {
  datasetSchemaVersion: '2';
  datasetId: string;
  createdAt: number;
  appVersion: string;
  buildId: string;
  sourceTreeSha256: string | null;
  gitCommit: string | null;
  gitWorkingTreeClean: boolean | null;
  tickCount: number;
  decisionCount: number;
  signalCount: number;
  resultCount: number;
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
}
