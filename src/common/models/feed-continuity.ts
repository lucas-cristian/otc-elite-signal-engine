export type FeedContinuityEventType =
  | 'EPOCH_STARTED'
  | 'EPOCH_ENDED'
  | 'GAP_DETECTED'
  | 'CONNECTION_LOST'
  | 'SOURCE_SWITCH';

export interface FeedContinuityEvent {
  feedContinuityEventSchemaVersion: '1';
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
