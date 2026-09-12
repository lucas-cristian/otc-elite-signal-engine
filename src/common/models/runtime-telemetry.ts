export type SourceTabVisibility = 'visible' | 'hidden' | 'prerender' | 'unknown';
export type ShadowFeedState =
  | 'WAITING_CONTEXT'
  | 'ENGINE_CONNECTING'
  | 'ENGINE_OPEN'
  | 'NAMESPACE_CONNECTING'
  | 'NAMESPACE_OPEN'
  | 'AUTH_SENT'
  | 'AUTHENTICATED'
  | 'SUBSCRIPTIONS_REPLAYED'
  | 'STREAMING'
  | 'BACKOFF'
  | 'CIRCUIT_OPEN'
  | 'ERROR';

export type TransportEventType =
  | 'PORT_CONNECTED'
  | 'PORT_DISCONNECTED'
  | 'TAB_LIFECYCLE'
  | 'PAGE_WS_OPEN'
  | 'PAGE_WS_CLOSE'
  | 'PAGE_WS_ERROR'
  | 'SHADOW_WS_CONNECTING'
  | 'SHADOW_WS_OPEN'
  | 'SHADOW_NAMESPACE_CONNECTING'
  | 'SHADOW_NAMESPACE_OPEN'
  | 'SHADOW_AUTH_SENT'
  | 'SHADOW_AUTHENTICATED'
  | 'SHADOW_SUBSCRIPTIONS_REPLAYED'
  | 'SHADOW_STREAMING'
  | 'SHADOW_WS_CLOSE'
  | 'SHADOW_WS_ERROR'
  | 'SHADOW_RECONNECT_SCHEDULED'
  | 'SHADOW_FORCED_RECONNECT'
  | 'SHADOW_CIRCUIT_OPEN'
  | 'SHADOW_CIRCUIT_RESET'
  | 'SHADOW_STALL_DETECTED';

export interface TransportEventRecord {
  transportEventSchemaVersion: '2';
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
  transportSchemaVersion: '3';
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
  shadowPrimary: boolean;
  shadowState: ShadowFeedState;
  shadowEndpointHost: string | null;
  shadowReconnectAttempts: number;
  shadowConsecutiveNamespaceRejects: number;
  shadowCircuitOpen: boolean;
  shadowLastMessageAt: number | null;
  shadowLastPriceAt: number | null;
  shadowLastErrorReason: string | null;
  shadowLastCommandAt: number | null;
  mitigation: 'MAIN_WORLD_NATIVE_SHADOW_RUNTIME_PORT_WATCHDOG_AUTO_DISCARD_DISABLED';
}
