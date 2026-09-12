export type SourceTabVisibility = 'visible' | 'hidden' | 'prerender' | 'unknown';

export interface CaptureTransportSnapshot {
  transportSchemaVersion: '1';
  tabId: number | null;
  pageSessionId: string | null;
  connected: boolean;
  visibility: SourceTabVisibility;
  frozen: boolean | null;
  discarded: boolean | null;
  autoDiscardable: boolean | null;
  lastSemanticEventAt: number | null;
  lastLifecycleEventAt: number | null;
  lastConnectionEventAt: number | null;
  lastLifecycleReason: string | null;
  mitigation: 'RUNTIME_PORT_MICROTASK_FLUSH_AUTO_DISCARD_DISABLED';
}
