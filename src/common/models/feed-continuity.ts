export type FeedContinuityEventType =
  | 'EPOCH_STARTED'
  | 'EPOCH_ENDED'
  | 'GAP_DETECTED'
  | 'CONNECTION_LOST'
  | 'SOURCE_SWITCH'
  | 'SHORT_RECONNECT_GAP'
  | 'PRIMARY_TRANSPORT_HANDOFF';

export interface FeedContinuityEvent {
  feedContinuityEventSchemaVersion: '3';
  continuityEventId: string;
  canonicalAssetId: string;
  feedId: string;
  feedEpochId: string;
  eventType: FeedContinuityEventType;
  occurredAt: number;
  connectionId: string | null;
  previousConnectionId: string | null;
  pageSessionId: string | null;
  gapMs: number | null;
  reason: string;
}
