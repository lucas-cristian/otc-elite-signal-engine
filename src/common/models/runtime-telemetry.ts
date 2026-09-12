export type SourceTabVisibility = 'visible' | 'hidden' | 'prerender' | 'unknown';
export type ShadowFeedState = 'WAITING_CONTEXT' | 'CONNECTING' | 'NAMESPACE_OPEN' | 'AUTHENTICATING' | 'STREAMING' | 'BACKOFF' | 'ERROR';
export type TransportEventType =
  | 'PORT_CONNECTED'
  | 'PORT_DISCONNECTED'
  | 'TAB_LIFECYCLE'
  | 'PAGE_WS_OPEN'
  | 'PAGE_WS_CLOSE'
  | 'PAGE_WS_ERROR'
  | 'SHADOW_WS_CONNECTING'
  | 'SHADOW_WS_OPEN'
  | 'SHADOW_AUTHENTICATED'
  | 'SHADOW_WS_CLOSE'
  | 'SHADOW_WS_ERROR'
  | 'SHADOW_RECONNECT_SCHEDULED'
  | 'SHADOW_STALL_DETECTED';

export interface TransportEventRecord {
  transportEventSchemaVersion: '1';
  transportEventId: string;
  eventType: TransportEventType;
  occurredAt: number;
  tabId: number | null;
  pageSessionId: string | null;
  connectionId: string | null;
  endpointHost: string | null;
  visibility: SourceTabVisibility;
  shadow: boolean;
  reason: string | null;
}

export interface CaptureTransportSnapshot {
  transportSchemaVersion: '2';
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
  shadowConnected: boolean;
  shadowState: ShadowFeedState;
  shadowEndpointHost: string | null;
  shadowReconnectAttempts: number;
  shadowLastMessageAt: number | null;
  shadowLastPriceAt: number | null;
  shadowLastErrorReason: string | null;
  mitigation: 'RUNTIME_PORT_MICROTASK_FLUSH_AUTO_DISCARD_DISABLED_SHADOW_WS';
}
